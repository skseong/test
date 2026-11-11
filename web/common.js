/* 화면이 공유하는 파일 읽기와 서버 문항 API. Blob 토큰은 서버에만 둔다. */
(function (root) {
  'use strict';
  const CSV_FIELDS = ['파일명', '위원회', '의원', '제출기한', '문항번호', '요구내용', '세부항목', '비고'];
  const LOCAL_KEY = 'assembly-request-cases-v2';
  const isVercel = /(^|\.)vercel\.app$/.test(location.hostname);
  let cases = [];
  let rawDb = { cases: [] };
  let orgPromise;
  const historyCache = new Map();

  function loadOrg() {
    if (!orgPromise) orgPromise = readData('A부_조직도_26개과.csv').then(csv => {
      const [header, ...rows] = RequestEngine.parseCsv(csv);
      return rows.map(row => ({ 과: row[header.indexOf('과')] })).filter(row => row.과);
    });
    return orgPromise;
  }

  async function request(method, body) {
    if (!isVercel) {
      if (method === 'GET') return readBrowserDb();
      if (body?.작업 === 'AI추천') throw new Error('AI 추천은 Vercel 배포 화면에서 사용할 수 있습니다.');
      const changed = root.RequestFlow.apply(rawDb, body, await loadOrg());
      localStorage.setItem(LOCAL_KEY, JSON.stringify(changed.db));
      rawDb = changed.db;
      return changed.result;
    }
    if (method === 'POST' && body.action && root.RequestFlow) root.RequestFlow.apply(rawDb, body, await loadOrg());
    const response = await fetch('/api/app', {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw new Error(data?.error || '서버 API에 연결하지 못했습니다. Vercel 배포 주소에서 열어 주세요.');
    return data;
  }

  function readBrowserDb() {
    try {
      const saved = localStorage.getItem(LOCAL_KEY);
      if (saved) {
        const db = JSON.parse(saved);
        if (Array.isArray(db.cases)) return db;
      }
      const old = JSON.parse(localStorage.getItem('assembly-request-cases-v1') || '[]');
      if (!Array.isArray(old)) return { cases: [] };
      const db = { cases: old.map((item, index) => ({
        caseId: item.id || `C-legacy-${index + 1}`, version: 1,
        receipt: { receivedAt: '', committee: item.위원회 || '', member: item.의원 || '',
          sourceRef: item.파일명 || '', dueAt: item.제출기한 || '', format: '' },
        question: { number: String(item.문항번호 || ''), text: item.요구내용 || '',
          periodStart: '', periodEnd: '', note: [item.세부항목, item.비고].filter(Boolean).join(' / ') },
        status: item.status || '접수', assignment: item.assignment ? { ...item.assignment, round: 1 } : null,
        replies: [], events: Array.isArray(item.events) ? item.events : []
      })) };
      if (old.length) localStorage.setItem(LOCAL_KEY, JSON.stringify(db));
      return db;
    } catch { throw new Error('브라우저 저장 기록을 읽지 못했습니다.'); }
  }

  function showStorage() {
    for (const badge of document.querySelectorAll('.storage-badge')) {
      badge.textContent = isVercel ? '● Vercel 비공개 저장소' : '● 이 브라우저에 저장';
    }
    const label = document.getElementById('storage-label');
    if (label) label.textContent = isVercel ? '비공개 저장소' : '브라우저 저장';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showStorage);
  else showStorage();

  async function loadCases() {
    rawDb = await request('GET');
    cases = rawDb.cases.map(item => ({
      ...item, id: item.caseId,
      파일명: item.receipt.sourceRef, 위원회: item.receipt.committee,
      의원: item.receipt.member, 제출기한: item.receipt.dueAt,
      문항번호: item.question.number, 요구내용: item.question.text,
      세부항목: '', 비고: item.question.note
    }));
    return cases;
  }

  async function getHistory(keyword) {
    const key = String(keyword || '').trim();
    if (!key || !isVercel) return null;
    if (!historyCache.has(key)) {
      historyCache.set(key, fetch(`/api/app?view=history&keyword=${encodeURIComponent(key)}`, {
        credentials: 'same-origin', cache: 'no-store'
      }).then(async response => {
        const data = await response.json().catch(() => null);
        if (!response.ok || !data) throw new Error(data?.error || '과거 이력을 읽지 못했습니다.');
        return data;
      }));
    }
    return historyCache.get(key);
  }

  async function renderHistory(node, keyword) {
    node.replaceChildren();
    if (!keyword) { node.textContent = '과거 이력: 근거 키워드 없음'; return; }
    const data = await getHistory(keyword);
    if (!data) { node.textContent = '과거 이력: 비공개 Vercel 화면에서 조회'; return; }
    if (!data.count) { node.textContent = '과거 이력: 일치하는 요구 없음'; return; }
    const title = document.createElement('strong');
    title.textContent = `과거 이력 ${data.count}건 · 주로 ${data.mainDepartment || '미분류'}`;
    const list = document.createElement('ul');
    for (const row of data.recent) {
      const li = document.createElement('li');
      li.textContent = `${row.date} · ${row.text} · ${row.department}`;
      list.append(li);
    }
    node.append(title, list);
  }

  function parseRows(rows, source) {
    if (!rows.length) throw new Error(`${source}가 비어 있습니다.`);
    const [header, ...body] = rows;
    for (const field of CSV_FIELDS) {
      if (!header.includes(field)) throw new Error(`${source}에 "${field}" 열이 없습니다.`);
    }
    return body.map((cells, i) => {
      if (cells.length !== header.length) throw new Error(`${source} ${i + 2}행의 열 수가 맞지 않습니다.`);
      return Object.fromEntries(header.map((name, n) => [name, String(cells[n] ?? '')]));
    });
  }

  function parseCsv(text) {
    return parseRows(RequestEngine.parseCsv(text), 'CSV');
  }

  async function readCsvFile(file) {
    return parseCsv(await file.text());
  }

  async function readXlsxFile(file) {
    if (!root.XLSX) throw new Error('SheetJS를 읽지 못했습니다.');
    const book = root.XLSX.read(await file.arrayBuffer());
    const sheet = book.Sheets[book.SheetNames[0]];
    if (!sheet) throw new Error('엑셀 첫 시트가 비어 있습니다.');
    const rows = root.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false })
      .filter(row => row.some(cell => String(cell).trim() !== ''));
    const width = rows[0]?.length || 0;
    return parseRows(rows.map(row => Array.from({ length: width }, (_, i) => row[i] ?? '')), '엑셀');
  }

  function exportXlsx() {
    if (!root.XLSX) throw new Error('SheetJS를 읽지 못했습니다.');
    const fields = [...CSV_FIELDS, '상태', '주관 과', '협조 과', '확정방법', '확정일시'];
    const rows = cases.map(item => [
      ...CSV_FIELDS.map(field => String(item[field] ?? '')),
      item.status, item.assignment?.lead || '', (item.assignment?.support || []).join(', '),
      item.assignment?.method || '', item.assignment?.confirmedAt || ''
    ]);
    const book = root.XLSX.utils.book_new();
    const sheet = root.XLSX.utils.aoa_to_sheet([fields, ...rows]);
    root.XLSX.utils.book_append_sheet(book, sheet, '배분현황');
    root.XLSX.writeFile(book, '배분현황.xlsx');
    return rows.length;
  }

  async function readData(name) {
    if (!/^[^/\\]+\.csv$/.test(name)) throw new Error('CSV 파일명만 지정할 수 있습니다.');
    const response = await fetch(new URL(`data/${name}`, document.baseURI));
    if (!response.ok) throw new Error(`자료를 읽지 못했습니다: ${name}`);
    return response.text();
  }

  function getCases() {
    return cases;
  }

  async function register(rows) {
    if (!rows.length) throw new Error('접수할 문항이 없습니다.');
    const batches = new Map();
    for (const row of rows) {
      const key = [row.파일명, row.위원회, row.의원, row.제출기한].join('\u001f');
      if (!batches.has(key)) batches.set(key, {
        action: '접수', receipt: { sourceRef: row.파일명, committee: row.위원회,
          member: row.의원, dueAt: row.제출기한 }, questions: []
      });
      batches.get(key).questions.push({ number: String(row.문항번호), text: row.요구내용,
        note: [row.세부항목, row.비고].filter(Boolean).join(' / ') });
    }
    const result = { added: 0, skipped: 0 };
    for (const batch of batches.values()) {
      const saved = await request('POST', batch);
      result.added += saved.added;
      result.skipped += saved.skipped;
    }
    await loadCases();
    return result;
  }

  async function confirm(id, lead, support, method, reason, validDepartments) {
    const valid = new Set(validDepartments);
    if (!valid.has(lead)) throw new Error('주관 과가 조직도에 없습니다.');
    if (support.some((department) => !valid.has(department) || department === lead)) {
      throw new Error('협조 과는 조직도의 다른 과만 선택할 수 있습니다.');
    }
    const item = cases.find((value) => value.id === id);
    if (!item) throw new Error('저장된 문항을 찾지 못했습니다.');
    const result = await request('POST', { action: '배분', caseId: id, version: item.version,
      lead, support, method, reason });
    await loadCases();
    return result;
  }

  root.RequestCommon = { CSV_FIELDS, parseCsv, readCsvFile, readXlsxFile, exportXlsx,
    readData, getCases, loadCases, getHistory, renderHistory, request, register, confirm, isVercel };
})(globalThis);
