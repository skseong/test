const assert = require('node:assert/strict');
const { createHandler } = require('./api/app.js');
const org = require('./api/org.json');

const first = org[0].과;
const second = org[1].과;
const third = org[2].과;
let document = { cases: [] };
let writes = 0;
const fakeStore = {
  async read() { return { db: structuredClone(document), etag: String(writes) }; },
  async write(db) { document = structuredClone(db); writes++; },
  async history() { return [
    { 접수일: '2026-09-12', 접수번호: '2026-0001', 요구내용: '가상 안전 자료', 배분과: first },
    { 접수일: '2026-09-13', 접수번호: '2026-0002', 요구내용: '가상 안전 현황', 배분과: first },
    { 접수일: '2026-09-14', 접수번호: '2026-0003', 요구내용: '가상 안전 기준', 배분과: second }
  ]; }
};
const handler = createHandler(fakeStore);
async function call(method, body, query) {
  const req = { method, body, query, headers: { 'content-length': String(JSON.stringify(body || {}).length) } };
  const res = { headers: {}, setHeader(key, val) { this.headers[key] = val; },
    status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  await handler(req, res);
  return res;
}

(async () => {
  let count = 0;
  const check = (condition, label) => { assert.ok(condition, label); count++; console.log(`통과 ${count}: ${label}`); };
  let res = await call('GET');
  check(res.code === 200 && res.body.cases.length === 0, '빈 cases.json 전체 조회');
  res = await call('GET', null, { view: 'history', keyword: '안전' });
  check(res.code === 200 && res.body.count === 3 && res.body.mainDepartment === first &&
    res.body.recent[0].date === '2026-09-14', '비공개 과거 이력 건수·주된 과·최근 순서');

  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'fake-test-key';
  let fakePayload;
  const aiHandler = createHandler(fakeStore, async (payload, key) => {
    fakePayload = { payload, key };
    return { choices: [{ message: { content: JSON.stringify({
      후보: [first, second, third, '조직도 밖 부서'].map(과 => ({ 과, 근거: `${과} 업무와 요구내용이 일치합니다.` })),
      해당없음: false
    }) } }] };
  });
  res = await (async () => {
    const req = { method: 'POST', body: { 작업: 'AI추천', 요구내용: '가상 안전 정책 자료' }, headers: {} };
    const response = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(v) { this.body = v; return this; } };
    await aiHandler(req, response); return response;
  })();
  check(res.code === 200 && res.body.후보.length === 3 && !res.body.후보.some(x => x.과 === '조직도 밖 부서'), 'AI 후보를 조직도 안 최대 3개로 제한');
  check(fakePayload.payload.model === 'gpt-4o-mini' && fakePayload.payload.temperature === 0 &&
    fakePayload.payload.response_format.type === 'json_schema' && fakePayload.key === 'fake-test-key', 'Chat Completions 모델·온도·JSON 설정');

  const noneHandler = createHandler(fakeStore, async () => ({ choices: [{ message: { content: JSON.stringify({ 후보: [], 해당없음: true }) } }] }));
  res = await (async () => {
    const req = { method: 'POST', body: { 작업: 'AI추천', 요구내용: '가상 문항' }, headers: {} };
    const response = { headers: {}, setHeader() {}, status(c) { this.code = c; return this; }, json(v) { this.body = v; return this; } };
    await noneHandler(req, response); return response;
  })();
  check(res.code === 200 && res.body.해당없음 && res.body.후보.length === 0, 'AI 해당없음 응답');

  delete process.env.OPENAI_API_KEY;
  const missingKeyHandler = createHandler(fakeStore, async () => { throw new Error('호출되면 안 됨'); });
  res = await (async () => {
    const req = { method: 'POST', body: { 작업: 'AI추천', 요구내용: '가상 문항' }, headers: {} };
    const response = { headers: {}, setHeader() {}, status(c) { this.code = c; return this; }, json(v) { this.body = v; return this; } };
    await missingKeyHandler(req, response); return response;
  })();
  if (previousKey !== undefined) process.env.OPENAI_API_KEY = previousKey;
  check(res.code === 500 && res.body.error.includes('OPENAI_API_KEY'), '키 미설정 시 500 안내');

  res = await call('POST', { action: '접수', receipt: {
    sourceRef: '가상 요구서', committee: '가상 위원회', member: '의원G',
    contact: '저장 금지'
  }, questions: [{ number: '1', text: '가상 정책 자료', personName: '저장 금지' }] });
  const caseId = res.body.created[0].caseId;
  check(res.code === 200 && res.body.added === 1 && document.cases.length === 1, '접수 저장');
  check(!('contact' in document.cases[0].receipt) && !('personName' in document.cases[0].question), '설계 외 이름·연락처 필드 제거');
  res = await call('POST', { action: '회신', caseId, version: 1, department: first, reply: { ref: '가상' } });
  check(res.code === 403, '담당 과가 정해지기 전 회신 거부');
  res = await call('POST', { action: '배분', caseId, version: 1, lead: '없는 과', support: [], method: '규칙' });
  check(res.code === 400, '조직도 밖 과 거부');
  res = await call('POST', { action: '배분', caseId, version: 1, lead: first, support: [second], method: '규칙' });
  check(res.code === 200 && res.body.status === '배분확정' && res.body.version === 2, '주관·협조 과 배분');
  res = await call('POST', { action: '회신', caseId, version: 2, department: third, reply: { ref: '가상' } });
  check(res.code === 403, '담당 아닌 과 회신 거부');
  res = await call('POST', { action: '회신', caseId, version: 2, department: first, reply: { ref: '가상 내부 참조' } });
  check(res.code === 200 && res.body.status === '회신중', '주관 과만 회신하면 회신중');
  res = await call('POST', { action: '회신', caseId, version: 2, department: second, reply: { noData: true } });
  check(res.code === 409, '오래된 버전 저장 거부');
  res = await call('POST', { action: '재배정요청', caseId, version: 3, department: second, reason: '' });
  check(res.code === 400, '재배정 사유 필수');
  res = await call('POST', { action: '회신', caseId, version: 3, department: second, reply: { noData: true } });
  check(res.code === 200 && res.body.status === '회신완료', '모든 과 회신이면 회신완료');
  res = await call('POST', { action: '재배정요청', caseId, version: 4, department: first, reason: '가상 사유' });
  check(res.code === 409, '완료 후 순서에 어긋난 재배정 거부');
  check(writes === 4 && document.cases[0].events.length === 4, '오류 요청은 저장하지 않고 이력 유지');

  res = await call('POST', { action: '접수', receipt: { sourceRef: '가상 요구서 2', member: '의원G' },
    questions: [{ number: '2', text: '가상 행정 자료' }] });
  const secondId = res.body.created[0].caseId;
  await call('POST', { action: '배분', caseId: secondId, version: 1, lead: first, support: [], method: '규칙' });
  res = await call('POST', { action: '재배정요청', caseId: secondId, version: 2,
    department: first, reason: '가상 소관 이의', suggestedDepartment: second });
  check(res.code === 200 && res.body.status === '재배정요청' &&
    document.cases[1].events.at(-1).suggestedDepartment === second, '담당 과 재배정요청과 희망 과 기록');
  res = await call('POST', { action: '배분', caseId: secondId, version: 3, lead: second,
    support: [], method: '수정', reason: '가상 재확인' });
  check(res.code === 200 && document.cases[1].assignment.lead === second &&
    document.cases[1].events.at(-1).before.lead === first, '재배분과 이전 배분 이력 보존');
  res = await call('POST', { action: 'AI추천', caseId: secondId, version: 4 });
  check(res.code === 400, 'S7 AI추천은 아직 지원하지 않음');
  console.log(`결과: ${count}개 항목 모두 통과, 가짜 저장소 ${writes}회 기록, 실제 Blob 쓰기 0회`);
})().catch(error => { console.error(error); process.exitCode = 1; });
