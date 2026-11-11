(async function () {
  'use strict';
  const message = document.getElementById('message');
  const items = document.getElementById('items');
  const department = document.getElementById('department');
  let departments = [];
  const el = (tag, content, className = '') => {
    const node = document.createElement(tag);
    node.textContent = content;
    node.className = className;
    return node;
  };
  const show = (value, error = false) => {
    message.textContent = value;
    message.className = `message ${error ? 'error' : 'success'}`;
  };

  function showChecks(container, issues) {
    container.replaceChildren();
    if (!issues.length) {
      container.append(el('p', '자동 점검에서 확인필요 항목을 찾지 못했습니다.', 'validation-ok'));
      return;
    }
    const list = document.createElement('ul');
    list.className = 'validation-list';
    for (const issue of issues) {
      const row = el('li', `${issue.row ? `${issue.row}행 · ` : ''}${issue.column ? `${issue.column} · ` : ''}${issue.message}`);
      list.append(row);
    }
    container.append(el('strong', `확인필요 ${issues.length}건`), list);
  }

  async function render() {
    const cases = await RequestCommon.loadCases();
    items.replaceChildren();
    if (!department.value) return;
    const shown = cases.filter(item => item.assignment &&
      [item.assignment.lead, ...item.assignment.support].includes(department.value));
    if (!shown.length) items.append(el('p', '이 과에 배분된 문항이 없습니다.', 'empty'));
    for (const item of shown) {
      const card = el('article', '', 'dept-card');
      card.append(el('h2', `${item.의원} · ${item.문항번호}번`), el('p', item.요구내용),
        el('p', `상태: ${item.status} · 역할: ${item.assignment.lead === department.value ? '주관' : '협조'} · 제출기한: ${item.제출기한 || '미지정'}`, 'small muted'));
      const isSupplementTarget = item.status === '보완요청' && item.supplement?.department === department.value;
      if (item.status === '보완요청') {
        card.append(el('p', isSupplementTarget ? `보완 요청: ${item.supplement.reason}` : '다른 과의 보완 회신을 기다리는 중입니다.', isSupplementTarget ? 'warning' : 'small muted'));
      }
      const prior = [...(item.replies || [])].reverse().find(value => value.department === department.value && value.round === item.assignment.round);
      if (prior) card.append(el('p', `현재 회신: ${prior.noData ? '자료 없음' : prior.ref}`, 'small'));
      const history = el('div', '과거 이력 조회 중…', 'small muted');
      card.append(history);
      const top = RequestEngine.classify(item.요구내용)[0];
      RequestCommon.renderHistory(history, top?.근거키워드).catch(() => {
        history.textContent = '과거 이력을 읽지 못했습니다.';
      });

      const canReply = ['배분확정', '회신중'].includes(item.status) || isSupplementTarget;
      if (canReply) {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = '.xlsx,.xls';
        input.setAttribute('aria-label', `${item.문항번호}번 회신 엑셀 올리기`);
        const fileLabel = el('label', '회신 엑셀 올리기', 'button'); fileLabel.append(input);
        const fileState = el('span', '선택한 파일 없음', 'small muted');
        const checksBox = el('div', '', 'validation-panel');
        let selected = null;
        input.addEventListener('change', async () => {
          try {
            const file = input.files[0];
            if (!file) { selected = null; fileState.textContent = '선택한 파일 없음'; checksBox.replaceChildren(); return; }
            if (file.size > 8 * 1024 * 1024) throw new Error('엑셀 파일은 8MB 이하로 선택해 주세요.');
            const rows = RequestValidate.readXlsx(await file.arrayBuffer(), XLSX);
            const result = RequestValidate.validate(rows, item.요구내용);
            selected = { name: file.name, rows, issues: result.issues };
            fileState.textContent = `${file.name} · ${rows.length}행 · 원본 셀 값은 수정하지 않습니다.`;
            showChecks(checksBox, selected.issues);
          } catch (error) {
            selected = null; input.value = ''; checksBox.replaceChildren(); show(error.message, true);
          }
        });
        const ref = document.createElement('input'); ref.placeholder = '내부 자료 참조값 (선택)';
        ref.setAttribute('aria-label', `${item.문항번호}번 내부 자료 참조값`);
        const note = document.createElement('input'); note.placeholder = '메모';
        note.setAttribute('aria-label', `${item.문항번호}번 회신 메모`);
        const noData = document.createElement('input'); noData.type = 'checkbox';
        const noDataLabel = el('label', ' 자료 없음'); noDataLabel.prepend(noData);
        const submit = el('button', '회신 제출', 'button primary');
        submit.type = 'button';
        submit.addEventListener('click', async () => {
          try {
            if (!selected && !noData.checked) throw new Error('회신 엑셀을 선택하거나 자료 없음을 표시해 주세요.');
            if (selected?.issues.length && !window.confirm(`자동 점검에서 확인필요 ${selected.issues.length}건을 찾았습니다. 확인 내용을 검토했으며 원본 값을 그대로 제출할까요?`)) return;
            submit.disabled = true;
            const reply = { ref: ref.value.trim() || selected?.name || '', noData: noData.checked };
            if (selected) reply.table = selected.rows;
            const payload = { action: '회신', caseId: item.caseId, version: item.version,
              department: department.value, reply, note: note.value };
            if (new TextEncoder().encode(JSON.stringify(payload)).length > 900 * 1024) {
              throw new Error('회신 표가 너무 커서 저장할 수 없습니다. 열·행을 줄인 사본으로 다시 제출해 주세요.');
            }
            await RequestCommon.request('POST', payload);
            await render(); show('회신과 원본 셀 값, 점검 결과를 저장했습니다.');
          } catch (error) { show(error.message, true); submit.disabled = false; }
        });
        card.append(fileLabel, fileState, checksBox, ref, note, noDataLabel, submit);
      }

      if (['배분확정', '회신중'].includes(item.status)) {
        const reason = document.createElement('input'); reason.placeholder = '재배정 요청 사유';
        reason.setAttribute('aria-label', `${item.문항번호}번 재배정 사유`);
        const desired = el('select', '', 'row-select');
        desired.setAttribute('aria-label', `${item.문항번호}번 희망 과`);
        const blank = el('option', '희망 과 선택'); blank.value = ''; desired.append(blank);
        for (const name of departments) {
          const option = el('option', name); option.value = name; desired.append(option);
        }
        const reassign = el('button', '재배정 요청', 'button');
        reassign.type = 'button';
        reassign.addEventListener('click', async () => {
          try {
            reassign.disabled = true;
            await RequestCommon.request('POST', { action: '재배정요청', caseId: item.caseId,
              version: item.version, department: department.value,
              reason: reason.value, suggestedDepartment: desired.value });
            await render(); show('재배정 요청을 저장했습니다.');
          } catch (error) { show(error.message, true); reassign.disabled = false; }
        });
        card.append(reason, desired, reassign);
      }
      items.append(card);
    }
  }
  try {
    const csv = await RequestCommon.readData('A부_조직도_26개과.csv');
    const [header, ...rows] = RequestEngine.parseCsv(csv);
    departments = rows.map(row => row[header.indexOf('과')]).filter(Boolean);
    for (const name of departments) {
      const option = el('option', name); option.value = name; department.append(option);
    }
    department.addEventListener('change', () => render().catch(error => show(error.message, true)));
    await RequestEngine.load({ rulesFile: 'rules_보강.csv' });
    await render();
  } catch (error) { show(error.message, true); }
})();
