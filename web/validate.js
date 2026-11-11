/* 회신 표의 읽기 전용 점검 규칙. 입력 행/셀 값은 수정하지 않는다. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RequestValidate = factory();
})(globalThis, function () {
  'use strict';
  const stringValue = value => value == null ? '' : String(value).trim();
  const emptyRow = row => !row.some(value => stringValue(value) !== '');

  function numberValue(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    let text = stringValue(value).replace(/[₩원\s]/g, '').replace(/,/g, '');
    if (!text || !/^-?\d+(?:\.\d+)?$/.test(text)) return null;
    return Number(text);
  }

  function findYearValues(rows) {
    const years = new Set();
    for (const row of rows) for (const value of row) {
      const text = stringValue(value);
      const matches = text.match(/(?:19|20)\d{2}/g) || [];
      for (const year of matches) years.add(Number(year));
      if (typeof value === 'number' && Number.isInteger(value) && value >= 1900 && value <= 2099) years.add(value);
    }
    return years;
  }

  function validate(inputRows, requirement = '', options = {}) {
    const rows = Array.isArray(inputRows) ? inputRows.map(row => Array.isArray(row) ? row.slice() : [row]) : [];
    while (rows.length && emptyRow(rows[rows.length - 1])) rows.pop();
    const issues = [];
    const add = (code, message, row = null, column = '') => issues.push({ code, message, row, column });
    if (!rows.length || emptyRow(rows[0] || [])) {
      add('REQUIREMENT_ROW', '1행에 접수번호·의원·문항·요구내용 표시가 없습니다.', 1);
    } else {
      const first = rows[0].map(stringValue).join(' ');
      const labels = ['접수번호', '의원', '문항', '요구내용'];
      const missing = labels.filter(label => !first.includes(label));
      if (missing.length) add('REQUIREMENT_ROW', `1행 요구 표시에서 확인할 항목: ${missing.join(', ')}`, 1);
    }

    const header = rows[1] || [];
    if (!header.length || emptyRow(header)) add('HEADER_ROW', '2행에 표 머리글이 없습니다.', 2);
    const headers = header.map(stringValue);
    const dataRows = rows.slice(2);
    const requirementText = stringValue(requirement) || (rows[0] || []).map(stringValue).join(' ');
    const recent = requirementText.match(/최근\s*(\d+)\s*년(?:간)?/);
    if (recent && Number(recent[1]) > 0 && Number(recent[1]) <= 50) {
      const count = Number(recent[1]);
      const currentYear = Number(options.currentYear) || new Date().getFullYear();
      const expected = Array.from({ length: count }, (_, index) => currentYear - count + index + 1);
      const found = findYearValues([headers, ...dataRows]);
      const missing = expected.filter(year => !found.has(year));
      if (missing.length) add('MISSING_YEARS', `최근 ${count}년 요구의 연도 누락: ${missing.join(', ')}`, null, '연도');
    }

    const budgetIndex = headers.findIndex(name => /예산/.test(name));
    const spendIndex = headers.findIndex(name => /(집행|지출)/.test(name));
    const noteIndex = headers.findIndex(name => /(비고|사유)/.test(name));
    if (budgetIndex >= 0 && spendIndex >= 0) {
      dataRows.forEach((row, index) => {
        const budget = numberValue(row[budgetIndex]);
        const spending = numberValue(row[spendIndex]);
        if (budget !== null && spending !== null && spending > budget &&
            (noteIndex < 0 || !stringValue(row[noteIndex]))) {
          add('SPEND_OVER_BUDGET', '집행액이 예산을 초과했지만 비고 사유가 없습니다.', index + 3, headers[spendIndex]);
        }
      });
    }

    const totalIndexes = dataRows.map((row, index) => ({ row, index }))
      .filter(({ row }) => row.some(value => /합계|총계|총\s*합/.test(stringValue(value))))
      .map(({ index }) => index);
    if (totalIndexes.length) {
      const detailRows = dataRows.filter((_, index) => !totalIndexes.includes(index));
      const width = Math.max(headers.length, ...dataRows.map(row => row.length));
      for (const totalIndex of totalIndexes) {
        const totalRow = dataRows[totalIndex];
        for (let columnIndex = 0; columnIndex < width; columnIndex++) {
          if (/(연도|년도|연번|번호|코드|비율|퍼센트|단가)/.test(headers[columnIndex] || '')) continue;
          const stated = numberValue(totalRow[columnIndex]);
          if (stated === null) continue;
          const values = detailRows.map(row => numberValue(row[columnIndex])).filter(value => value !== null);
          if (!values.length) continue;
          const calculated = values.reduce((sum, value) => sum + value, 0);
          const tolerance = Math.max(0.01, Math.abs(calculated) * 1e-9);
          if (Math.abs(stated - calculated) > tolerance) {
            add('TOTAL_MISMATCH', `합계 행 값(${stated})과 세부 행 합(${calculated})이 다릅니다.`, totalIndex + 3,
              headers[columnIndex] || `열 ${columnIndex + 1}`);
          }
        }
      }
    }
    return { issues, hasNeedsReview: issues.length > 0, rows };
  }

  function readXlsx(buffer, xlsx) {
    if (!xlsx) throw new Error('SheetJS를 읽지 못했습니다.');
    const workbook = xlsx.read(buffer, { cellDates: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new Error('엑셀 첫 시트가 비어 있습니다.');
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true, blankrows: true });
    while (rows.length && emptyRow(rows[rows.length - 1])) rows.pop();
    return rows;
  }

  function readCsv(text, papa) {
    if (!papa) throw new Error('Papa Parse를 읽지 못했습니다.');
    const parsed = papa.parse(text, { header: false, skipEmptyLines: 'greedy', dynamicTyping: false });
    if (parsed.errors.some(error => error.code !== 'UndetectableDelimiter')) {
      throw new Error('CSV 형식을 읽지 못했습니다.');
    }
    return parsed.data;
  }

  return { validate, readXlsx, readCsv, numberValue };
});
