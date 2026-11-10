(function () {
  'use strict';
  const pdfInput = document.getElementById('pdf-files');
  const csvInput = document.getElementById('csv-file');
  const xlsxInput = document.getElementById('xlsx-file');
  const message = document.getElementById('load-message');
  const previewWrap = document.getElementById('preview-wrap');
  const previewBody = document.getElementById('preview-body');
  const caseBody = document.getElementById('case-body');
  const filter = document.getElementById('status-filter');
  let preview = [];
  let departments = [];

  function el(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = value;
    return node;
  }
  function showMessage(value, kind = '') {
    message.className = `message ${kind}`;
    message.textContent = value;
  }
  function detail(label, content, className = '') {
    const node = el('details', className);
    node.append(el('summary', '', label), el('div', '', content));
    return node;
  }
  function renderPreview() {
    previewBody.replaceChildren();
    previewWrap.hidden = preview.length === 0;
    document.getElementById('preview-count').textContent = `${preview.length}문항`;
    for (const row of preview) {
      const tr = el('tr');
      tr.append(
        el('td', 'small muted', row.파일명),
        el('td', 'strong', `${row.의원} · ${row.문항번호}번`),
        el('td', '', row.요구내용),
        el('td', 'small', [row.세부항목, row.비고 && `비고: ${row.비고}`].filter(Boolean).join(' / '))
      );
      previewBody.append(tr);
    }
  }
  function selectForLead(selected) {
    const select = el('select', 'row-select');
    select.setAttribute('aria-label', '주관 과 선택');
    const blank = el('option', '', '주관 과 선택');
    blank.value = '';
    select.append(blank);
    for (const department of departments) {
      const option = el('option', '', department);
      option.value = department;
      select.append(option);
    }
    select.value = selected || '';
    return select;
  }
  function supportPicker(item) {
    const box = el('details', 'support-details');
    box.append(el('summary', '', `협조 과 선택${item.assignment?.support?.length ? ` (${item.assignment.support.length})` : ''}`));
    const options = el('div', 'support-options');
    for (const department of departments) {
      const label = el('label');
      const check = el('input');
      check.type = 'checkbox';
      check.value = department;
      check.checked = item.assignment?.support?.includes(department) || false;
      label.append(check, document.createTextNode(department));
      options.append(label);
    }
    box.append(options);
    return box;
  }
  function renderCases() {
    caseBody.replaceChildren();
    const cases = RequestCommon.getCases();
    const shown = cases.filter(item => filter.value === 'all' || item.status === filter.value);
    document.getElementById('list-count').textContent = `${shown.length}문항`;
    document.getElementById('empty').hidden = shown.length > 0;
    for (const item of shown) {
      const candidates = RequestEngine.classify(item.요구내용);
      const topPriority = candidates[0]?.우선순위;
      const tied = candidates.filter(c => c.우선순위 === topPriority).length > 1;
      const defaultLead = tied ? '' : candidates[0]?.과 || '';
      const statusCell = el('td');
      statusCell.append(el('span', `status ${item.status === '배분확정' ? 'done' : ''}`, item.status));
      const memberCell = el('td');
      memberCell.append(el('div', 'strong', `${item.의원} · ${item.문항번호}번`), el('div', 'small muted', item.위원회), el('div', 'small muted', item.제출기한 || '기한 없음'));
      const contentCell = el('td');
      contentCell.append(el('div', '', item.요구내용));
      if (item.세부항목 || item.비고) {
        contentCell.append(detail('세부항목 · 비고', [item.세부항목, item.비고 && `비고: ${item.비고}`].filter(Boolean).join(' / '), 'content-details'));
      }
      const candidateCell = el('td');
      if (!candidates.length) candidateCell.append(el('span', 'muted', '일치 규칙 없음'));
      candidates.forEach((candidate, i) => {
        const row = el('span', 'candidate');
        row.append(el('b', '', `${i + 1}. ${candidate.과}`), el('small', '', ` · 우선순위 ${candidate.우선순위} · ${candidate.근거키워드}`));
        candidateCell.append(row);
      });
      if (tied || !candidates.length) candidateCell.append(el('div', 'warning', tied ? '동순위 · 확인필요' : '무일치 · 확인필요'));
      const selectCell = el('td');
      const lead = selectForLead(item.assignment?.lead || defaultLead);
      const support = supportPicker(item);
      selectCell.append(lead, support);
      const actionCell = el('td');
      const reason = el('input', 'reason-input');
      reason.type = 'text';
      reason.placeholder = '수정·확인 사유';
      reason.setAttribute('aria-label', `${item.의원} ${item.문항번호}번 수정 또는 확인 사유`);
      const button = el('button', 'button primary row-action', item.status === '배분확정' ? '배분 수정' : '배분 확정');
      button.type = 'button';
      button.addEventListener('click', () => {
        const selectedSupport = [...support.querySelectorAll('input:checked')].map(input => input.value);
        const isRule = !tied && !!defaultLead && lead.value === defaultLead && selectedSupport.length === 0 && !item.assignment;
        const method = isRule ? '규칙' : '수정';
        if (!lead.value) { alert('주관 과를 선택해 주세요.'); return; }
        if (method === '수정' && !reason.value.trim()) { alert('수정·확인 사유를 입력해 주세요.'); reason.focus(); return; }
        try {
          RequestCommon.confirm(item.id, lead.value, selectedSupport, method,
            reason.value.trim() || '기준표 후보 확인', departments);
          renderCases();
          showMessage(`${item.의원} ${item.문항번호}번 문항의 배분을 저장했습니다.`, 'success');
        } catch (error) { showMessage(error.message, 'error'); }
      });
      actionCell.append(button, reason);
      if (item.assignment) {
        actionCell.append(el('div', 'method', `확정방법: ${item.assignment.method}`));
        const history = el('details', 'history-details');
        history.append(el('summary', '', `이력 ${item.events.length}건`));
        for (const event of item.events) {
          history.append(el('div', '', `${new Date(event.at).toLocaleString('ko-KR')} · ${event.type}${event.method ? ` (${event.method})` : ''}${event.reason ? ` · ${event.reason}` : ''}${event.after ? ` · ${event.after.lead}` : ''}`));
        }
        actionCell.append(history);
      }
      const tr = el('tr');
      tr.append(statusCell, memberCell, contentCell, candidateCell, selectCell, actionCell);
      caseBody.append(tr);
    }
  }
  async function loadPdfFiles(files) {
    if (!files.length) return;
    showMessage(`${files.length}개 PDF에서 글자를 읽고 있습니다…`);
    try {
      const batches = [];
      for (const file of files) batches.push(await RequestSplit.parsePdf(file));
      preview = batches.flat();
      renderPreview();
      showMessage(`${files.length}개 PDF에서 ${preview.length}문항을 분해했습니다. 원문과 대조한 뒤 접수 등록하세요.`, 'success');
    } catch (error) {
      preview = [];
      renderPreview();
      showMessage(error.message, 'error');
    }
  }
  pdfInput.addEventListener('change', () => loadPdfFiles([...pdfInput.files]));
  csvInput.addEventListener('change', async () => {
    if (!csvInput.files.length) return;
    try {
      preview = await RequestCommon.readCsvFile(csvInput.files[0]);
      renderPreview();
      showMessage(`CSV에서 ${preview.length}문항을 읽었습니다. 내용을 확인한 뒤 접수 등록하세요.`, 'success');
    } catch (error) { preview = []; renderPreview(); showMessage(error.message, 'error'); }
  });
  xlsxInput.addEventListener('change', async () => {
    if (!xlsxInput.files.length) return;
    try {
      preview = await RequestCommon.readXlsxFile(xlsxInput.files[0]);
      renderPreview();
      showMessage(`엑셀에서 ${preview.length}문항을 읽었습니다. 내용을 확인한 뒤 접수 등록하세요.`, 'success');
    } catch (error) { preview = []; renderPreview(); showMessage(error.message, 'error'); }
  });
  document.getElementById('export-xlsx').addEventListener('click', () => {
    try {
      const count = RequestCommon.exportXlsx();
      showMessage(`${count}문항의 배분현황 엑셀 파일을 저장했습니다.`, 'success');
    } catch (error) { showMessage(error.message, 'error'); }
  });
  document.getElementById('register').addEventListener('click', () => {
    try {
      const result = RequestCommon.register(preview);
      preview = [];
      pdfInput.value = '';
      csvInput.value = '';
      xlsxInput.value = '';
      renderPreview();
      renderCases();
      showMessage(`${result.added}문항 접수 등록 완료${result.skipped ? ` · 중복 ${result.skipped}문항 건너뜀` : ''}`, 'success');
    } catch (error) { showMessage(error.message, 'error'); }
  });
  filter.addEventListener('change', renderCases);
  (async () => {
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
      const [info, orgText] = await Promise.all([
        RequestEngine.load({ rulesFile: 'rules_보강.csv' }),
        RequestCommon.readData('A부_조직도_26개과.csv')
      ]);
      const [header, ...rows] = RequestEngine.parseCsv(orgText);
      const column = header.indexOf('과');
      departments = rows.map(row => row[column]).filter(Boolean);
      if (departments.length !== 26 || info.부서수 !== 26) throw new Error('조직도 26개 과를 확인하지 못했습니다.');
      renderCases();
    } catch (error) {
      document.getElementById('empty').textContent = `자료를 읽지 못했습니다: ${error.message}. http://localhost:8000에서 열어 주세요.`;
      showMessage(error.message, 'error');
    }
  })();
})();
