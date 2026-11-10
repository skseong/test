(async function () {
  'use strict';
  try {
    const cases = RequestCommon.getCases();
    const confirmed = cases.filter(item => item.status === '배분확정');
    document.getElementById('total').textContent = cases.length;
    document.getElementById('received').textContent = cases.filter(item => item.status === '접수').length;
    document.getElementById('confirmed').textContent = confirmed.length;
    if (!confirmed.length) return;

    const orgText = await RequestCommon.readData('A부_조직도_26개과.csv');
    const [header, ...rows] = RequestEngine.parseCsv(orgText);
    const column = header.indexOf('과');
    const departments = rows.map(row => row[column]).filter(Boolean);
    if (departments.length !== 26) throw new Error('조직도 26개 과를 확인하지 못했습니다.');
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
      type: 'bar',
      data: {
        labels: active.map(([name]) => name),
        datasets: [{ label: '배분확정', data: active.map(([, count]) => count),
          backgroundColor: '#2a799b', borderRadius: 4 }]
      },
      options: {
        indexAxis: 'y', maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, ticks: { precision: 0 } }, y: { grid: { display: false } } }
      }
    });
  } catch (error) {
    document.getElementById('chart-empty').textContent = `현황을 표시하지 못했습니다: ${error.message}`;
  }
})();
