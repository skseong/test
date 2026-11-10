const { get, put, BlobPreconditionFailedError } = require('@vercel/blob');
const { apply, FlowError } = require('../web/flow.js');
const Papa = require('../web/lib/papaparse.min.js');
const org = require('./org.json');

const PATH = 'cases.json';
const storage = {
  async read() {
    const blob = await get(PATH, { access: 'private', token: token(), useCache: false });
    if (!blob) return { db: { cases: [] }, etag: null };
    const db = await new Response(blob.stream).json();
    if (!db || !Array.isArray(db.cases)) throw new Error('cases.json 형식이 올바르지 않습니다.');
    return { db, etag: blob.blob.etag };
  },
  async write(db, etag) {
    await put(PATH, JSON.stringify(db), {
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

function createHandler(store = storage) {
  return async function handler(req, res) {
    try {
      if (req.method === 'GET') {
        if (req.query?.view === 'history') {
          const keyword = String(req.query.keyword || '').trim();
          if (!keyword || keyword.length > 100) throw new FlowError(400, '근거 키워드를 확인해 주세요.');
          return send(res, 200, summarizeHistory(await store.history(), keyword));
        }
        const { db } = await store.read();
        return send(res, 200, db);
      }
      if (req.method !== 'POST') return send(res, 405, { error: '허용되지 않는 요청입니다.' });
      if (Number(req.headers['content-length'] || 0) > 1024 * 1024) {
        throw new FlowError(413, '요청 크기가 1MB를 넘습니다.');
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        const { db, etag } = await store.read();
        const changed = apply(db, req.body, org);
        if (req.body.action === '접수' && changed.result.added === 0) return send(res, 200, changed.result);
        try {
          await store.write(changed.db, etag);
          return send(res, 200, changed.result);
        } catch (error) {
          if (error instanceof BlobPreconditionFailedError && attempt < 2) continue;
          throw error;
        }
      }
    } catch (error) {
      if (error instanceof FlowError) return send(res, error.status, { error: error.message });
      if (error instanceof BlobPreconditionFailedError) return send(res, 409, { error: '동시 변경이 발생했습니다. 다시 시도해 주세요.' });
      console.error('문항 API 오류:', error);
      return send(res, 500, { error: '서버 저장소를 확인해 주세요.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.summarizeHistory = summarizeHistory;
