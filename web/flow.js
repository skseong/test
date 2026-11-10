/* 브라우저와 서버가 공유하는 문항 상태 규칙. 저장은 호출자가 담당한다. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RequestFlow = factory();
})(globalThis, function () {
  'use strict';
  class FlowError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }
  const value = input => String(input ?? '').trim();
  const pick = (source, keys, limit = 1000) => Object.fromEntries(
    keys.map(key => [key, value(source?.[key]).slice(0, limit)])
  );
  const fail = (status, message) => { throw new FlowError(status, message); };
  const now = () => new Date().toISOString();
  const departments = org => {
    const names = new Set(org.map(row => row.과).filter(Boolean));
    if (names.size !== 26) throw new Error('조직도 26개 과를 확인하지 못했습니다.');
    return names;
  };
  const validDepartment = (name, names) => {
    if (!names.has(name)) fail(400, '조직도에 없는 과입니다.');
  };
  const resultOf = item => ({ caseId: item.caseId, status: item.status, version: item.version });

  function apply(db, request, org) {
    if (!db || !Array.isArray(db.cases) || !request || typeof request !== 'object') fail(400, '요청 형식이 올바르지 않습니다.');
    const names = departments(org);
    const next = { cases: structuredClone(db.cases) };
    if (request.action === '접수') {
      const questions = request.questions;
      if (!Array.isArray(questions) || !questions.length || questions.length > 100) fail(400, '문항은 1~100개여야 합니다.');
      const receipt = pick(request.receipt, ['receivedAt', 'committee', 'member', 'sourceRef', 'dueAt', 'format']);
      let serial = next.cases.reduce((max, item) => Math.max(max, Number(String(item.caseId).slice(2)) || 0), 0);
      const created = [];
      for (const raw of questions) {
        const question = pick(raw, ['number', 'text', 'periodStart', 'periodEnd', 'note'], 10000);
        if (!question.number || !question.text) fail(400, '문항번호와 요구내용이 필요합니다.');
        const duplicate = next.cases.some(item => item.receipt.sourceRef === receipt.sourceRef &&
          item.receipt.member === receipt.member && item.question.number === question.number && item.question.text === question.text);
        if (duplicate) continue;
        const at = now();
        const item = { caseId: `C-${String(++serial).padStart(4, '0')}`, version: 1,
          receipt: { ...receipt, receivedAt: receipt.receivedAt || at.slice(0, 10) }, question,
          status: '접수', assignment: null, replies: [], events: [{ type: '접수', at, by: '국회 총괄 담당' }] };
        next.cases.push(item);
        created.push(resultOf(item));
      }
      return { db: next, result: { created, added: created.length, skipped: questions.length - created.length } };
    }
    if (!['배분', '회신', '재배정요청'].includes(request.action)) fail(400, '지원하지 않는 작업입니다.');
    const item = next.cases.find(row => row.caseId === request.caseId);
    if (!item) fail(404, '문항을 찾지 못했습니다.');
    if (item.version !== request.version) fail(409, '문항이 변경되었습니다. 새로고침해 주세요.');
    const at = now();
    if (request.action === '배분') {
      if (!['접수', '재배정요청', '배분확정'].includes(item.status)) fail(409, '현재 상태에서는 배분할 수 없습니다.');
      const lead = value(request.lead);
      const support = request.support;
      validDepartment(lead, names);
      if (!Array.isArray(support) || new Set(support).size !== support.length || support.includes(lead)) fail(400, '협조 과를 확인해 주세요.');
      for (const name of support) validDepartment(name, names);
      const method = value(request.method);
      if (!['규칙', 'AI', '수정'].includes(method)) fail(400, '확정방법은 규칙·AI·수정 중 하나여야 합니다.');
      const reason = value(request.reason);
      if ((method === '수정' || item.status !== '접수') && !reason) fail(400, '배분 수정·재확정 사유가 필요합니다.');
      const before = item.assignment ? structuredClone(item.assignment) : null;
      item.assignment = { lead, support: [...support], method, confirmedAt: at,
        round: (item.assignment?.round || 0) + 1 };
      item.status = '배분확정';
      item.events.push({ type: '배분확정', at, by: '국회 총괄 담당', method, reason,
        before, after: { lead, support: [...support] } });
    } else {
      const department = value(request.department);
      validDepartment(department, names);
      if (![item.assignment?.lead, ...(item.assignment?.support || [])].includes(department)) fail(403, '이 문항의 담당 과가 아닙니다.');
      if (request.action === '재배정요청') {
        if (!['배분확정', '회신중'].includes(item.status)) fail(409, '현재 상태에서는 재배정을 요청할 수 없습니다.');
        const reason = value(request.reason);
        if (!reason) fail(400, '재배정 요청 사유가 필요합니다.');
        const suggestedDepartment = value(request.suggestedDepartment);
        if (suggestedDepartment) validDepartment(suggestedDepartment, names);
        item.status = '재배정요청';
        item.events.push({ type: '재배정요청', at, by: department, reason, suggestedDepartment });
      } else {
        if (!['배분확정', '회신중'].includes(item.status)) fail(409, '현재 상태에서는 회신할 수 없습니다.');
        const reply = pick(request.reply, ['ref', 'evidenceRef']);
        reply.noData = request.reply?.noData === true;
        if (!reply.ref && !reply.noData) fail(400, '회신 자료 참조 또는 자료 없음 표시가 필요합니다.');
        const round = item.assignment.round;
        item.replies.push({ department, ...reply, note: value(request.note).slice(0, 1000), round, at });
        const assigned = [item.assignment.lead, ...item.assignment.support];
        item.status = assigned.every(name => item.replies.some(row => row.round === round && row.department === name))
          ? '회신완료' : '회신중';
        item.events.push({ type: '회신', at, by: department, after: { ...reply } });
      }
    }
    item.version++;
    return { db: next, result: resultOf(item) };
  }
  return { apply, FlowError };
});
