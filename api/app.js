const { get, put, BlobPreconditionFailedError } = require('@vercel/blob');
const { randomUUID } = require('node:crypto');
const { apply, FlowError } = require('../web/flow.js');
const Papa = require('../web/lib/papaparse.min.js');
const org = require('./org.json');

const PATH = 'cases.json';
const WRITE_LOCK_KEY = '_writeLock';
const WRITE_LOCK_LEASE_MS = 25000;
const WRITE_LOCK_WAIT_MS = 30000;
class OpenAIRequestError extends Error {
  constructor(status, code, type) {
    super(`OpenAI HTTP ${status}`);
    this.status = status;
    this.code = code || '';
    this.type = type || '';
  }
}
const storage = {
  async read() {
    const blob = await get(PATH, { access: 'private', token: token(), useCache: false });
    if (!blob) return { db: { cases: [] }, etag: null };
    const db = await new Response(blob.stream).json();
    if (!db || !Array.isArray(db.cases)) throw new Error('cases.json 형식이 올바르지 않습니다.');
    return { db, etag: blob.blob.etag };
  },
  async write(db, etag) {
    return put(PATH, JSON.stringify(db), {
      access: 'private', token: token(), contentType: 'application/json',
      cacheControlMaxAge: 60, allowOverwrite: !!etag, ...(etag ? { ifMatch: etag } : {})
    });
  },
  async history() {
    const blob = await get('접수대장.csv', { access: 'private', token: token(), useCache: false });
    if (!blob) return [];
    const csv = await new Response(blob.stream).text();
    const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
    if (parsed.errors.length) throw new Error('접수대장 CSV 형식이 올바르지 않습니다.');
    return parsed.data;
  }
};

function token() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new FlowError(503, 'Blob 토큰 환경변수가 없습니다.');
  return process.env.BLOB_READ_WRITE_TOKEN;
}
function send(res, status, body) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(status).json(body);
}

function isBlobConflict(error) {
  return error instanceof BlobPreconditionFailedError ||
    error?.name === 'BlobAlreadyExistsError' || error?.status === 412;
}
function conflictError() {
  const error = new Error('cases.json 저장 충돌');
  Object.setPrototypeOf(error, BlobPreconditionFailedError.prototype);
  return error;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function acquireWriteLock(store, owner) {
  const deadline = Date.now() + WRITE_LOCK_WAIT_MS;
  let attempt = 0;
  while (Date.now() < deadline) {
    const { db, etag } = await store.read();
    const lock = db[WRITE_LOCK_KEY];
    if (lock && lock.owner !== owner && lock.expiresAt > Date.now()) {
      await delay(100 + Math.floor(Math.random() * 125));
      continue;
    }
    try {
      const lockedDb = { ...db, [WRITE_LOCK_KEY]: { owner, expiresAt: Date.now() + WRITE_LOCK_LEASE_MS } };
      const saved = await store.write(lockedDb, etag);
      return { db: lockedDb, etag: saved?.etag };
    } catch (error) {
      if (!isBlobConflict(error)) throw error;
      await delay(Math.min(600, 50 * (2 ** Math.min(attempt++, 4))) + Math.floor(Math.random() * 125));
    }
  }
  throw conflictError();
}

async function releaseWriteLock(store, owner) {
  const { db, etag } = await store.read();
  if (db[WRITE_LOCK_KEY]?.owner !== owner) return;
  const cleanDb = { cases: db.cases };
  await store.write(cleanDb, etag);
}

async function updateCases(store, body) {
  const owner = randomUUID();
  let locked = await acquireWriteLock(store, owner);
  let committed = false;
  try {
    if (!locked.etag) locked = await store.read();
    const { db, etag } = locked;
    if (db[WRITE_LOCK_KEY]?.owner !== owner) throw conflictError();
    const changed = apply(db, body, org);
    await store.write({ cases: changed.db.cases }, etag);
    committed = true;
    return changed.result;
  } finally {
    if (!committed) {
      try { await releaseWriteLock(store, owner); }
      catch (error) { console.warn('cases.json 쓰기 잠금 해제가 지연될 수 있습니다.', { name: error?.name || 'Error' }); }
    }
  }
}

function summarizeHistory(rows, keyword) {
  const matched = rows.filter(row => String(row.요구내용 || '').includes(keyword));
  const counts = new Map();
  for (const row of matched) {
    const name = String(row.배분과 || '').trim();
    if (name) counts.set(name, (counts.get(name) || 0) + 1);
  }
  const mainDepartment = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))[0]?.[0] || '';
  const recent = matched.sort((a, b) =>
    String(b.접수일 || '').localeCompare(String(a.접수일 || '')) ||
    String(b.접수번호 || '').localeCompare(String(a.접수번호 || ''))).slice(0, 5)
    .map(row => ({ date: row.접수일 || '', text: row.요구내용 || '', department: row.배분과 || '' }));
  return { count: matched.length, mainDepartment, recent };
}

async function recommendDepartments(requirement, callOpenAI) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY 환경변수를 설정해 주세요.');
  const departments = org.map(row => row.과).filter(Boolean);
  const response = await callOpenAI({
    model: 'gpt-4o-mini', temperature: 0,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'department_recommendations', strict: true,
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            후보: { type: 'array', items: { type: 'object', additionalProperties: false,
              properties: { 과: { type: 'string' }, 근거: { type: 'string' } }, required: ['과', '근거'] } },
            해당없음: { type: 'boolean' }
          }, required: ['후보', '해당없음']
        }
      }
    },
    messages: [
      { role: 'system', content: `국회 자료요구 문항의 담당 과를 추천하세요. 주어진 조직도 과 목록에서만 최대 3개를 고르고, 각 과마다 근거를 한 문장으로 작성하세요. 합당한 과가 없으면 후보는 빈 배열, 해당없음은 true로 답하세요. 목록 외 과는 절대 만들지 마세요.\n과 목록: ${JSON.stringify(departments)}` },
      { role: 'user', content: String(requirement).slice(0, 10000) }
    ]
  }, apiKey);
  let parsed;
  try { parsed = JSON.parse(response.choices?.[0]?.message?.content || ''); }
  catch { throw new Error('OpenAI가 유효한 JSON 후보를 반환하지 않았습니다.'); }
  const allowed = new Set(departments);
  const seen = new Set();
  const candidates = (Array.isArray(parsed.후보) ? parsed.후보 : []).filter(item => {
    const name = String(item?.과 || '').trim();
    if (!allowed.has(name) || seen.has(name)) return false;
    seen.add(name);
    return true;
  }).slice(0, 3).map(item => ({ 과: String(item.과).trim(), 근거: String(item.근거 || '').trim().slice(0, 500) }));
  const none = parsed.해당없음 === true || candidates.length === 0;
  return { 후보: none ? [] : candidates, 해당없음: none };
}

async function callOpenAI(payload, apiKey) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    let details = {};
    try { details = (await response.json()).error || {}; } catch {}
    throw new OpenAIRequestError(response.status, details.code, details.type);
  }
  return response.json();
}

function openAIErrorMessage(error) {
  if (error.code === 'insufficient_quota' || error.type === 'insufficient_quota') {
    return 'OpenAI API 사용량 한도 또는 결제 설정을 확인해 주세요.';
  }
  if (error.status === 429) return 'OpenAI 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.';
  if (error.status === 401) return 'OPENAI_API_KEY가 유효한지 확인해 주세요. Vercel 환경변수 값을 점검하고 다시 배포하세요.';
  if (error.status === 403) return 'OpenAI 프로젝트의 모델 접근 권한을 확인해 주세요.';
  return 'AI 추천에 실패했습니다. Vercel 로그에서 OpenAI 오류를 확인해 주세요.';
}

function createHandler(store = storage, ai = callOpenAI) {
  return async function handler(req, res) {
    try {
      if (req.method === 'GET') {
        if (req.query?.view === 'history') {
          const keyword = String(req.query.keyword || '').trim();
          if (!keyword || keyword.length > 100) throw new FlowError(400, '근거 키워드를 확인해 주세요.');
          return send(res, 200, summarizeHistory(await store.history(), keyword));
        }
        const { db } = await store.read();
        return send(res, 200, { cases: db.cases });
      }
      if (req.method !== 'POST') return send(res, 405, { error: '허용되지 않는 요청입니다.' });
      if (Number(req.headers['content-length'] || 0) > 1024 * 1024) {
        throw new FlowError(413, '요청 크기가 1MB를 넘습니다.');
      }
      if (req.body?.작업 === 'AI추천') {
        const requirement = String(req.body.요구내용 || '').trim();
        if (!requirement || requirement.length > 10000) throw new FlowError(400, '요구내용을 확인해 주세요.');
        try {
          const result = await recommendDepartments(requirement, ai);
          return send(res, 200, result);
        } catch (error) {
          if (error.message.includes('OPENAI_API_KEY')) {
            console.error('AI 추천 오류: OPENAI_API_KEY 환경변수가 없습니다.');
            return send(res, 500, { error: '서버 환경변수 OPENAI_API_KEY를 설정해 주세요.' });
          }
          if (error instanceof OpenAIRequestError) {
            console.error('AI 추천 OpenAI 응답:', { status: error.status, code: error.code, type: error.type });
            return send(res, error.status === 429 ? 429 : 502, { error: openAIErrorMessage(error) });
          }
          console.error('AI 추천 오류:', error.message);
          return send(res, 502, { error: 'AI 추천에 실패했습니다. Vercel 로그에서 OpenAI 오류를 확인해 주세요.' });
        }
      }
      const result = await updateCases(store, req.body);
      return send(res, 200, result);
    } catch (error) {
      if (error instanceof FlowError) return send(res, error.status, { error: error.message });
      if (error instanceof BlobPreconditionFailedError) {
        console.warn('cases.json 쓰기 잠금 대기 시간 초과', {
          action: req.body?.action || 'unknown', waitMs: WRITE_LOCK_WAIT_MS
        });
        return send(res, 409, { error: '동시 변경이 발생했습니다. 다시 시도해 주세요.' });
      }
      console.error('문항 API 오류:', error);
      return send(res, 500, { error: '서버 저장소를 확인해 주세요.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.summarizeHistory = summarizeHistory;
module.exports.recommendDepartments = recommendDepartments;
module.exports.OpenAIRequestError = OpenAIRequestError;
