(async function () {
  'use strict';
  const caseSelect = document.getElementById('case-select');
  const reviewBody = document.getElementById('review-body');
  const reviewHead = document.getElementById('review-head');
  const issuesNode = document.getElementById('issues');
  const message = document.getElementById('collect-message');
  let cases = [];
  let chart;

  const el = (tag, value = '', className = '') => {
    const node = document.createElement(tag);
    node.textContent = value == null ? '' : String(value);
    node.className = className;
    return node;
  };
  const show = (text, error = false) => {
    message.textContent = text;
    message.className = `message ${error ? 'error' : 'success'}`;
  };
  const assignedDepartments = item => [...new Set([item.assignment?.lead, ...(item.assignment?.support || [])].filter(Boolean))];
  const latestReply = (item, department) => [...(item.replies || [])].reverse().find(reply =>
    reply.department === department && reply.round === item.assignment?.round);

  function issuesFor(item, department, reply) {
    if (!reply) return [];
    const found = Array.isArray(reply.table)
      ? RequestValidate.validate(reply.table, item.question.text).issues
      : (reply.checks || []);
    return found.map(issue => ({ ...issue, department }));
  }

  function mergedRows(item) {
    const sources = assignedDepartments(item).map(department => ({
      department, reply: latestReply(item, department)
    }));
    const headers = [];
    const issues = [];
    for (const source of sources) {
      issues.push(...issuesFor(item, source.department, source.reply));
      const sourceHeaders = source.reply?.table?.[1] || [];
      for (const header of sourceHeaders) {
        const name = String(header ?? '').trim();
        if (name && !['회신과', '확인필요'].includes(name) && !headers.includes(name)) headers.push(name);
      }
    }
    const rows = [];
    for (const source of sources) {
      const table = source.reply?.table;
      if (!Array.isArray(table)) continue;
      const sourceHeaders = (table[1] || []).map(value => String(value ?? '').trim());
      table.slice(2).forEach((cells, sourceIndex) => {
        const sourceRowNumber = sourceIndex + 3;
        const rowIssues = issues.filter(issue => issue.department === source.department && issue.row === sourceRowNumber);
        const values = headers.map(header => {
          const index = sourceHeaders.indexOf(header);
          return index >= 0 ? (cells[index] ?? '') : '';
        });
        rows.push({ department: source.department, values,
          warning: rowIssues.map(issue => issue.message).join(' · ') });
      });
    }
    return { headers, rows, issues, sources };
  }

  function renderMerged(item) {
    reviewHead.replaceChildren();
    reviewBody.replaceChildren();
    issuesNode.replaceChildren();
    const merged = mergedRows(item);
    const tr = document.createElement('tr');
    for (const name of ['회신과', ...merged.headers, '확인필요']) tr.append(el('th', name));
    reviewHead.append(tr);
    for (const row of merged.rows) {
      const line = document.createElement('tr');
      line.append(el('td', row.department));
      row.values.forEach(value => line.append(el('td', value)));
      line.append(el('td', row.warning, row.warning ? 'warning' : ''));
      reviewBody.append(line);
    }
    if (!merged.rows.length) {
      const line = document.createElement('tr');
      const cell = el('td', '표 데이터가 있는 회신이 없습니다. 기존 회신은 참조만 저장했을 수 있습니다.');
      cell.colSpan = Math.max(3, merged.headers.length + 2);
      line.append(cell); reviewBody.append(line);
    }
    if (!merged.issues.length) issuesNode.append(el('p', '자동 점검에서 확인필요 항목을 찾지 못했습니다.', 'validation-ok'));
    else {
      issuesNode.append(el('strong', `확인필요 ${merged.issues.length}건`));
      const list = document.createElement('ul'); list.className = 'validation-list';
      for (const issue of merged.issues) {
        const place = [issue.department, issue.row && `${issue.row}행`, issue.column].filter(Boolean).join(' · ');
        list.append(el('li', `${place ? `${place} · ` : ''}${issue.message}`));
      }
      issuesNode.append(list);
    }
    document.getElementById('review-meta').textContent =
      `${item.caseId} · ${item.의원} ${item.문항번호}번 · 현재 상태 ${item.status} · 담당 ${merged.sources.length}개 과`;
    const supplementSelect = document.getElementById('supplement-department');
    const blank = el('option', '보완 대상 과 선택'); blank.value = '';
    supplementSelect.replaceChildren(blank);
    for (const name of assignedDepartments(item).filter(name => latestReply(item, name))) {
      const option = el('option', name); option.value = name;
      supplementSelect.append(option);
    }
    document.getElementById('request-supplement').disabled = !['회신중', '회신완료'].includes(item.status);
    document.getElementById('confirm-review').disabled = item.status !== '회신완료';
    document.getElementById('confirm-review').dataset.codes = JSON.stringify([...new Set(merged.issues.map(issue => issue.code))]);
    return merged;
  }

  function renderStatus() {
    const counts = new Map();
    for (const item of cases) counts.set(item.status, (counts.get(item.status) || 0) + 1);
    const node = document.getElementById('status-counts');
    node.replaceChildren();
    for (const [status, count] of [...counts].sort((a, b) => a[0].localeCompare(b[0], 'ko'))) {
      const card = el('div', '', 'stat');
      card.append(el('span', status), el('strong', count)); node.append(card);
    }
    const countsByDepartment = new Map();
    for (const item of cases) {
      const lead = item.assignment?.lead;
      if (lead) countsByDepartment.set(lead, (countsByDepartment.get(lead) || 0) + 1);
    }
    if (chart) chart.destroy();
    const active = [...countsByDepartment].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
    document.getElementById('collect-chart-empty').hidden = active.length > 0;
    if (active.length && window.Chart) {
      chart = new Chart(document.getElementById('collect-chart'), {
        type: 'bar', data: { labels: active.map(([name]) => name), datasets: [{
          label: '문항', data: active.map(([, count]) => count), backgroundColor: '#2a799b', borderRadius: 4
        }] }, options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } }
      });
      document.getElementById('collect-chart-wrap').hidden = false;
      document.getElementById('collect-chart-wrap').style.height = `${Math.max(190, active.length * 34 + 45)}px`;
    } else document.getElementById('collect-chart-wrap').hidden = true;
  }

  async function reload() {
    cases = await RequestCommon.loadCases();
    renderStatus();
    const selected = caseSelect.value;
    const eligible = cases.filter(item => item.assignment);
    caseSelect.replaceChildren(el('option', '문항 선택'));
    for (const item of eligible) {
      const option = el('option', `${item.caseId} · ${item.의원} ${item.문항번호}번 · ${item.status}`);
      option.value = item.caseId; caseSelect.append(option);
    }
    if (eligible.some(item => item.caseId === selected)) caseSelect.value = selected;
    else caseSelect.value = eligible[0]?.caseId || '';
    const item = eligible.find(value => value.caseId === caseSelect.value);
    document.getElementById('review-panel').hidden = !item;
    if (item) renderMerged(item);
  }

  caseSelect.addEventListener('change', () => {
    const item = cases.find(value => value.caseId === caseSelect.value);
    document.getElementById('review-panel').hidden = !item;
    if (item) renderMerged(item);
  });

  document.getElementById('request-supplement').addEventListener('click', async () => {
    const item = cases.find(value => value.caseId === caseSelect.value);
    const target = document.getElementById('supplement-department').value;
    const reason = document.getElementById('supplement-reason').value.trim();
    try {
      if (!item || !target) throw new Error('보완 대상 과를 선택해 주세요.');
      if (!reason) throw new Error('보완 요청 사유를 입력해 주세요.');
      const merged = mergedRows(item);
      const codes = [...new Set(merged.issues.filter(issue => issue.department === target).map(issue => issue.code))];
      await RequestCommon.request('POST', { action: '보완요청', caseId: item.caseId,
        version: item.version, department: target, checkCodes: codes, reason });
      document.getElementById('supplement-reason').value = '';
      await reload(); show(`${target}에 보완을 요청했습니다. 다른 과에는 요청하지 않았습니다.`);
    } catch (error) { show(error.message, true); }
  });

  document.getElementById('confirm-review').addEventListener('click', async () => {
    const item = cases.find(value => value.caseId === caseSelect.value);
    const comment = document.getElementById('confirmation-comment').value.trim();
    const button = document.getElementById('confirm-review');
    try {
      if (!item) throw new Error('확정할 문항을 선택해 주세요.');
      if (!comment) throw new Error('확정 코멘트를 입력해 주세요.');
      const codes = JSON.parse(button.dataset.codes || '[]');
      if (codes.length && !document.getElementById('checks-reviewed').checked) {
        throw new Error('확인필요 항목을 검토한 뒤 확인 완료를 선택해 주세요.');
      }
      button.disabled = true;
      await RequestCommon.request('POST', { action: '확정', caseId: item.caseId, version: item.version,
        reviewedCheckCodes: codes, comment });
      await reload(); show('사람의 확인 완료를 기록했습니다. 결재나 제출 처리는 아닙니다.');
    } catch (error) { show(error.message, true); }
    finally { button.disabled = false; }
  });

  document.getElementById('verification-csv').addEventListener('change', async event => {
    const output = document.getElementById('verification-results');
    output.replaceChildren();
    try {
      const file = event.target.files[0];
      if (!file) return;
      const rows = RequestValidate.readCsv(await file.text(), Papa);
      const result = RequestValidate.validate(rows, (rows[0] || []).join(' '));
      if (!result.issues.length) output.append(el('p', `${file.name}: 확인필요 항목을 찾지 못했습니다. 원본 CSV는 변경하지 않았습니다.`, 'validation-ok'));
      else {
        output.append(el('strong', `${file.name} · 확인필요 ${result.issues.length}건`));
        const list = document.createElement('ul'); list.className = 'validation-list';
        result.issues.forEach(issue => list.append(el('li', `${issue.row ? `${issue.row}행 · ` : ''}${issue.column ? `${issue.column} · ` : ''}${issue.message}`)));
        output.append(list);
      }
    } catch (error) { output.append(el('p', error.message, 'message error')); }
  });

  function submissionRows() {
    const list = [['문항ID', '위원회', '의원', '문항번호', '요구내용', '제출기한', '주관 과', '협조 과', '지금 상태', '확정 코멘트']];
    const readyCases = cases.filter(item => item.status === '확정');
    const assigned = readyCases.filter(item => item.assignment);
    const byCase = new Map(assigned.map(item => [item.caseId, mergedRows(item)]));
    const headers = [...new Set([...byCase.values()].flatMap(data => data.headers))];
    const merged = [['문항ID', '문항', '회신과', ...headers, '확인필요']];
    for (const item of readyCases) {
      list.push([item.caseId, item.위원회, item.의원, item.문항번호, item.요구내용,
        item.제출기한, item.assignment?.lead || '', (item.assignment?.support || []).join(', '),
        item.status, item.confirmation?.comment || '']);
      if (!item.assignment) continue;
      const data = byCase.get(item.caseId);
      for (const row of data.rows) {
        const values = new Map(data.headers.map((header, index) => [header, row.values[index]]));
        merged.push([item.caseId, `${item.의원} ${item.문항번호}번`, row.department,
          ...headers.map(header => values.get(header) ?? ''), row.warning]);
      }
      for (const issue of data.issues.filter(value => value.row == null)) {
        merged.push([item.caseId, `${item.의원} ${item.문항번호}번`, issue.department,
          ...headers.map(() => ''), issue.message]);
      }
    }
    return { list, merged };
  }

  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a'); link.href = url; link.download = name;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  document.getElementById('download-xlsx').addEventListener('click', () => {
    try {
      const book = XLSX.utils.book_new();
      const sheets = submissionRows();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(sheets.list), '제출목록');
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(sheets.merged), '문항별 취합표');
      XLSX.writeFile(book, '제출본_국회요구자료.xlsx');
      show('제출본 엑셀을 만들었습니다. 원본 값을 수정하지 않았습니다.');
    } catch (error) { show(error.message, true); }
  });

  document.getElementById('download-markdown').addEventListener('click', () => {
    const escape = value => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
    const lines = ['# 국회 요구자료 제출 준비 목록', '',
      '| 문항ID | 의원 | 문항 | 제출기한 | 주관 과 | 상태 | 확정 코멘트 |',
      '|---|---|---|---|---|---|---|'];
    for (const item of cases.filter(value => value.status === '확정')) lines.push(`| ${[item.caseId, item.의원, item.문항번호, item.제출기한,
      item.assignment?.lead || '', item.status, item.confirmation?.comment || ''].map(escape).join(' | ')} |`);
    lines.push('', '## 문항별 취합표', '');
    for (const item of cases.filter(value => value.status === '확정' && value.assignment)) {
      const data = mergedRows(item);
      lines.push(`### ${escape(item.caseId)} · ${escape(item.의원)} ${escape(item.문항번호)}번`, '',
        `| 회신과 | ${data.headers.map(escape).join(' | ')} | 확인필요 |`,
        `|---|${data.headers.map(() => '---').join('|')}|---|`);
      for (const row of data.rows) lines.push(`| ${[row.department, ...row.values, row.warning].map(escape).join(' | ')} |`);
      for (const issue of data.issues.filter(value => value.row == null)) {
        lines.push(`| ${[issue.department, ...data.headers.map(() => ''), `확인필요: ${issue.message}`].map(escape).join(' | ')} |`);
      }
      lines.push('');
    }
    download('제출본_국회요구자료.md', lines.join('\n'), 'text/markdown;charset=utf-8');
  });

  document.getElementById('refresh-collect').addEventListener('click', () => reload().catch(error => show(error.message, true)));
  try { await reload(); }
  catch (error) { show(error.message, true); }
})();
