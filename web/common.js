/* 화면이 공유하는 문항 저장소와 파일 읽기. 자료는 브라우저 안에만 저장한다. */
(function (root) {
  'use strict';
  const STORAGE_KEY = 'assembly-request-cases-v1';
  const CSV_FIELDS = ['파일명', '위원회', '의원', '제출기한', '문항번호', '요구내용', '세부항목', '비고'];

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
    const rows = getCases().map(item => [
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
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      throw new Error('브라우저에 저장된 문항을 읽지 못했습니다.');
    }
  }

  function saveCases(cases) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cases));
    } catch {
      throw new Error('브라우저 저장 공간이 부족합니다. 저장된 자료를 확인해 주세요.');
    }
  }

  function register(rows) {
    const cases = getCases();
    const existing = new Set(cases.map((item) => item.sourceKey));
    let added = 0;
    for (const row of rows) {
      const number = Number(row.문항번호);
      if (!row.요구내용?.trim() || !Number.isInteger(number) || number < 1) {
        throw new Error('문항번호와 요구내용을 확인해 주세요.');
      }
      const sourceKey = [row.파일명, row.위원회, row.의원, number, row.요구내용].join('\u001f');
      if (existing.has(sourceKey)) continue;
      cases.push({
        id: crypto.randomUUID(), sourceKey, ...row, 문항번호: number,
        status: '접수', assignment: null,
        events: [{ type: '접수', at: new Date().toISOString(), by: '국회 총괄 담당' }]
      });
      existing.add(sourceKey);
      added++;
    }
    saveCases(cases);
    return { added, skipped: rows.length - added };
  }

  function confirm(id, lead, support, method, reason, validDepartments) {
    const valid = new Set(validDepartments);
    if (!valid.has(lead)) throw new Error('주관 과가 조직도에 없습니다.');
    if (support.some((department) => !valid.has(department) || department === lead)) {
      throw new Error('협조 과는 조직도의 다른 과만 선택할 수 있습니다.');
    }
    const cases = getCases();
    const item = cases.find((value) => value.id === id);
    if (!item) throw new Error('저장된 문항을 찾지 못했습니다.');
    const before = item.assignment ? { ...item.assignment } : null;
    item.assignment = { lead, support, method, confirmedAt: new Date().toISOString() };
    item.status = '배분확정';
    item.events.push({
      type: '배분확정', at: item.assignment.confirmedAt, by: '국회 총괄 담당',
      method, reason, before, after: { lead, support }
    });
    saveCases(cases);
    return item;
  }

  root.RequestCommon = { CSV_FIELDS, parseCsv, readCsvFile, readXlsxFile, exportXlsx, readData, getCases, register, confirm };
})(globalThis);
