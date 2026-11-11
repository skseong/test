/* 시작 화면의 기록 변환·필터 규칙(브라우저/시험 공용). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RequestHistory = factory();
})(globalThis, function () {
  'use strict';
  function recordsFromCases(cases, departments = []) {
    const valid = new Set(departments);
    return cases.flatMap(item => (item.events || []).map(event => {
      const department = event.department || event.after?.lead ||
        (valid.has(event.by) ? event.by : '');
      return {
        at: event.at || '', action: event.type || '',
        question: String(item.question?.text || ''), department,
        status: item.status || '', caseId: item.caseId || ''
      };
    })).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }

  function filterRecords(records, filters = {}) {
    const action = String(filters.action || '');
    const department = String(filters.department || '');
    const questionPrefix = String(filters.questionPrefix || '').trim();
    return records.filter(record => (!action || record.action === action) &&
      (!department || record.department === department) &&
      (!questionPrefix || record.question.startsWith(questionPrefix)));
  }

  function formatKoreanDateTime(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return String(value || '');
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(date);
  }

  function exportRows(records) {
    return [['일시', '작업', '문항', '과', '지금상태'], ...records.map(record => [
      formatKoreanDateTime(record.at), record.action, record.question, record.department, record.status
    ])];
  }
  return { recordsFromCases, filterRecords, formatKoreanDateTime, exportRows };
});
