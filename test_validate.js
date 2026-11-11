const assert = require('node:assert/strict');
const { validate, numberValue } = require('./web/validate.js');
const { apply, FlowError } = require('./web/flow.js');
const XLSX = require('./web/lib/xlsx.full.min.js');
const Papa = require('./web/lib/papaparse.min.js');
const org = require('./api/org.json');

let passed = 0;
function check(condition, label) { assert.ok(condition, label); passed++; console.log(`통과 ${passed}: ${label}`); }
function expectFlowError(fn, status, label) {
  assert.throws(fn, error => error instanceof FlowError && error.status === status, label);
  passed++; console.log(`통과 ${passed}: ${label}`);
}

const source = [
  ['접수번호: 2026-0001', '의원: 의원G', '문항: 2', '요구내용: 최근 3년 예산 집행 내역'],
  ['연도', '예산(천원)', '집행액(천원)', '비고', '건수'],
  ['2024', 100, 120, '', 2],
  ['2026', 100, 90, '정상', 1],
  ['합계', 200, 210, '', 99]
];
const original = structuredClone(source);
const findings = validate(source, '최근 3년간 예산 집행 내역', { currentYear: 2026 }).issues;
check(!findings.some(issue => issue.code === 'REQUIREMENT_ROW'), '접수번호·의원·문항·요구내용이 있는 1행 통과');
check(validate([['요구내용: 최근 3년'], ['연도'], ['2024']], '최근 3년', { currentYear: 2026})
  .issues.some(issue => issue.code === 'REQUIREMENT_ROW'), '1행 요구 표시 누락 점검');
check(findings.some(issue => issue.code === 'MISSING_YEARS' && issue.message.includes('2025')), '최근 n년의 누락 연도 점검');
check(findings.some(issue => issue.code === 'SPEND_OVER_BUDGET' && issue.row === 3), '비고 없는 집행액 초과 점검');
check(findings.some(issue => issue.code === 'TOTAL_MISMATCH' && issue.column === '건수'), '합계 행 불일치 점검');
check(JSON.stringify(source) === JSON.stringify(original), '검사 과정에서 원본 셀 값 불변');
check(numberValue('1,250') === 1250 && numberValue('해당 없음') === null, '숫자 표기 해석');
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(source), '회신');
const workbookBytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
const parsedWorkbook = require('./web/validate.js').readXlsx(workbookBytes, XLSX);
check(parsedWorkbook.length === source.length && parsedWorkbook[2][0] === '2024', '엑셀 1행·머리글·데이터 값을 읽기 전용으로 파싱');
check(require('./web/validate.js').readCsv('요구내용,최근 2년\n연도,비고\n2025,\n', Papa).length === 3,
  '검증용 CSV 행 파싱');

const first = org[0].과;
const second = org[1].과;
let result = apply({ cases: [] }, { action: '접수', receipt: { sourceRef: '가상', member: '의원G' },
  questions: [{ number: '1', text: '최근 3년 예산 집행 내역' }] }, org);
let db = result.db;
const caseId = db.cases[0].caseId;
result = apply(db, { action: '배분', caseId, version: 1, lead: first, support: [second], method: '규칙' }, org);
db = result.db;
const needsCheckTable = [
  ['접수번호: 2026-0001', '의원: 의원G', '문항: 1', '요구내용: 최근 3년 예산 집행 내역'],
  ['연도', '예산(천원)', '집행액(천원)', '비고'], ['2024', 100, 120, '']
];
result = apply(db, { action: '회신', caseId, version: 2, department: first,
  reply: { ref: '가상 회신.xlsx', table: needsCheckTable } }, org);
db = result.db;
check(db.cases[0].status === '회신중' && db.cases[0].replies[0].checks.some(issue => issue.code === 'MISSING_YEARS'),
  '회신 저장 시 서버가 원본 표를 점검하고 확인필요를 보존');
result = apply(db, { action: '회신', caseId, version: 3, department: second,
  reply: { noData: true } }, org);
db = result.db;
check(db.cases[0].status === '회신완료', '모든 과의 회신 뒤 회신완료');
expectFlowError(() => apply(db, { action: '확정', caseId, version: 4,
  reviewedCheckCodes: ['MISSING_YEARS', 'SPEND_OVER_BUDGET'], comment: '' }, org), 400, '확정 코멘트 필수');
result = apply(db, { action: '보완요청', caseId, version: 4, department: first,
  checkCodes: ['MISSING_YEARS'], reason: '연도 보완 필요' }, org);
db = result.db;
check(db.cases[0].status === '보완요청' && db.cases[0].supplement.department === first,
  '대상 과와 사유가 있는 보완요청');
expectFlowError(() => apply(db, { action: '회신', caseId, version: 5, department: second,
  reply: { noData: true } }, org), 403, '보완 요청 대상이 아닌 과의 재회신 거부');
expectFlowError(() => apply(db, { action: '확정', caseId, version: 5,
  reviewedCheckCodes: [], comment: '검토' }, org), 409, '보완 회신 전에 확정 거부');
const correctedYearTable = [
  ['접수번호: 2026-0001', '의원: 의원G', '문항: 1', '요구내용: 최근 3년 예산 집행 내역'],
  ['연도', '예산(천원)', '집행액(천원)', '비고'], ['2024', 100, 90, ''], ['2025', 100, 90, ''], ['2026', 100, 90, '']
];
result = apply(db, { action: '회신', caseId, version: 5, department: first,
  reply: { ref: '가상 보완.xlsx', table: correctedYearTable } }, org);
db = result.db;
check(db.cases[0].status === '회신완료' && db.cases[0].replies.length === 3 &&
  db.cases[0].replies[0].table[2][0] === '2024' && db.cases[0].supplement.status === '완료',
  '보완 재회신을 추가하고 앞선 원회신을 보존');
result = apply(db, { action: '확정', caseId, version: 6,
  reviewedCheckCodes: [], comment: '회신과 점검 결과 확인 완료' }, org);
check(result.db.cases[0].status === '확정' && result.db.cases[0].confirmation.comment.includes('확인 완료'),
  '회신완료 문항의 확인 완료 기록');

console.log(`결과: ${passed}개 항목 모두 통과, 입력 자료는 가상 데이터만 사용`);
