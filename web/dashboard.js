(async function () {
  'use strict';
  const historyBody = document.getElementById('history-body');
  const actionFilter = document.getElementById('history-action');
  const departmentFilter = document.getElementById('history-department');
  const questionFilter = document.getElementById('history-question');
  let allRecords = [];
  let filteredRecords = [];

  function renderHistory() {
    filteredRecords = RequestHistory.filterRecords(allRecords, {
      action: actionFilter.value, department: departmentFilter.value,
      questionPrefix: questionFilter.value
    });
    document.getElementById('history-count').textContent = `${filteredRecords.length}건 / 전체 ${allRecords.length}건`;
    historyBody.replaceChildren();
    document.getElementById('history-empty').hidden = filteredRecords.length > 0;
    for (const record of filteredRecords) {
      const row = document.createElement('tr');
      for (const value of [RequestHistory.formatKoreanDateTime(record.at), record.action,
        record.question, record.department, record.status]) {
        const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
      }
      historyBody.append(row);
    }
  }

  async function loadDepartments() {
    const csv = await RequestCommon.readData('A부_조직도_26개과.csv');
    const [header, ...rows] = RequestEngine.parseCsv(csv);
    const names = rows.map(row => row[header.indexOf('과')]).filter(Boolean);
    departmentFilter.replaceChildren(new Option('전체 과', ''));
    for (const name of names) departmentFilter.append(new Option(name, name));
    return names;
  }

  async function renderDashboard(cases, departments) {
    const confirmed = cases.filter(item => item.status === '배분확정');
    document.getElementById('total').textContent = cases.length;
    document.getElementById('received').textContent = cases.filter(item => item.status === '접수').length;
    document.getElementById('confirmed').textContent = confirmed.length;
    const counts = new Map(departments.map(name => [name, 0]));
    for (const item of confirmed) {
      const lead = item.assignment?.lead;
      if (counts.has(lead)) counts.set(lead, counts.get(lead) + 1);
    }
    const active = [...counts].filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
    if (!active.length) return;
    document.getElementById('chart-empty').hidden = true;
    const wrap = document.getElementById('chart-wrap');
    wrap.hidden = false;
    wrap.style.height = `${Math.max(180, active.length * 42 + 50)}px`;
    new Chart(document.getElementById('department-chart'), {
      type: 'bar', data: { labels: active.map(([name]) => name), datasets: [{ label: '배분확정',
        data: active.map(([, count]) => count), backgroundColor: '#2a799b', borderRadius: 4 }] },
      options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, ticks: { precision: 0 } }, y: { grid: { display: false } } } }
    });
  }

  document.getElementById('history-export').addEventListener('click', () => {
    try {
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(RequestHistory.exportRows(filteredRecords)), '처리 기록');
      XLSX.writeFile(book, '처리기록_국회요구자료.xlsx');
    } catch (error) { alert(`엑셀을 만들지 못했습니다: ${error.message}`); }
  });
  actionFilter.addEventListener('change', renderHistory);
  departmentFilter.addEventListener('change', renderHistory);
  questionFilter.addEventListener('input', renderHistory);

  try {
    const [cases, departments] = await Promise.all([
      RequestCommon.loadCases(), loadDepartments()
    ]);
    document.getElementById('storage-label').textContent = RequestCommon.isVercel ? '비공개 저장소' : '브라우저 저장';
    allRecords = RequestHistory.recordsFromCases(cases, departments);
    const actions = [...new Set(allRecords.map(record => record.action).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
    for (const action of actions) actionFilter.append(new Option(action, action));
    renderHistory();
    await renderDashboard(cases, departments);
  } catch (error) {
    document.getElementById('chart-empty').textContent = `현황을 표시하지 못했습니다: ${error.message}`;
    document.getElementById('history-empty').hidden = false;
    document.getElementById('history-empty').textContent = `처리 기록을 읽지 못했습니다: ${error.message}`;
  }
})();
