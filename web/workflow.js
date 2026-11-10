(async function () {
  'use strict';
  const message = document.getElementById('message');
  const items = document.getElementById('items');
  const department = document.getElementById('department');
  const el = (tag, value, className = '') => {
    const node = document.createElement(tag);
    node.textContent = value;
    node.className = className;
    return node;
  };
  const show = (value, error = false) => { message.textContent = value; message.className = `message ${error ? 'error' : 'success'}`; };

  async function render() {
    const cases = await RequestCommon.loadCases();
    items.replaceChildren();
    const shown = cases.filter(item => ['배분확정', '회신중', '재배정요청', '회신완료'].includes(item.status) &&
      [item.assignment?.lead, ...(item.assignment?.support || [])].includes(department.value));
    if (!shown.length) items.append(el('p', '표시할 문항이 없습니다.', 'empty'));
    for (const item of shown) {
      const card = el('article', '', 'card');
      card.append(el('h2', `${item.의원} · ${item.문항번호}번`), el('p', item.요구내용),
        el('p', `상태: ${item.status} · 주관: ${item.assignment.lead} · 협조: ${item.assignment.support.join(', ') || '없음'}`, 'muted'));
      const prior = [...(item.replies || [])].reverse().find(value =>
        value.department === department.value && value.round === item.assignment.round);
      if (prior) card.append(el('p', `기록된 회신: ${prior.noData ? '자료 없음' : prior.ref}`));
      if (['배분확정', '회신중'].includes(item.status)) {
        const ref = document.createElement('input'); ref.placeholder = '내부 회신 자료 참조값';
        ref.setAttribute('aria-label', '내부 회신 자료 참조값');
        const noData = document.createElement('input'); noData.type = 'checkbox';
        const label = el('label', ' 자료 없음'); label.prepend(noData);
        const note = document.createElement('input'); note.placeholder = '회신 메모';
        note.setAttribute('aria-label', '회신 메모');
        const button = el('button', '회신 등록', 'button primary');
        button.addEventListener('click', async () => {
          try {
            await RequestCommon.request('POST', { action: '회신', caseId: item.caseId,
              version: item.version, department: department.value,
              reply: { ref: ref.value, noData: noData.checked }, note: note.value });
            await render(); show('회신을 저장했습니다.');
          } catch (error) { show(error.message, true); }
        });
        const reason = document.createElement('input'); reason.placeholder = '재배정 요청 사유';
        reason.setAttribute('aria-label', '재배정 요청 사유');
        const reassign = el('button', '재배정 요청', 'button');
        reassign.addEventListener('click', async () => {
          try {
            await RequestCommon.request('POST', { action: '재배정요청', caseId: item.caseId,
              version: item.version, department: department.value, reason: reason.value });
            await render(); show('재배정 요청을 저장했습니다.');
          } catch (error) { show(error.message, true); }
        });
        card.append(ref, label, note, button, reason, reassign);
      }
      items.append(card);
    }
  }

  try {
    const csv = await RequestCommon.readData('A부_조직도_26개과.csv');
    const [header, ...rows] = RequestEngine.parseCsv(csv);
    for (const row of rows) {
      const name = row[header.indexOf('과')];
      const option = el('option', name); option.value = name; department.append(option);
    }
    department.addEventListener('change', () => render().catch(error => show(error.message, true)));
    await render();
  } catch (error) { show(error.message, true); }
})();
