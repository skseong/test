const { get, put, BlobPreconditionFailedError } = require('@vercel/blob');
const { apply, FlowError } = require('../web/flow.js');
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

function createHandler(store = storage) {
  return async function handler(req, res) {
    try {
      if (req.method === 'GET') {
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
