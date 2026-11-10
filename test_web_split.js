const fs = require('node:fs');
const path = require('node:path');
const pdfjs = require('./web/lib/pdf.min.js');
pdfjs.GlobalWorkerOptions.workerSrc = path.resolve('web/lib/pdf.worker.min.js');
const { parseCsv } = require('./web/engine.js');
require('./web/split.js');

async function main() {
  const files = fs.readdirSync('원문').filter(name => name.endsWith('.pdf')).sort();
  const actual = [];
  for (const file of files) {
    const data = new Uint8Array(fs.readFileSync(path.join('원문', file)));
    const pdf = await pdfjs.getDocument({ data, disableFontFace: true }).promise;
    const lines = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      lines.push(...RequestSplit.linesFromItems((await (await pdf.getPage(n)).getTextContent()).items));
    }
    const rows = RequestSplit.parseLines(lines, file);
    actual.push(...rows);
    console.log(`${file}: ${rows.length}문항, 마지막 번호 ${rows.at(-1)?.문항번호}`);
  }
  const csv = parseCsv(fs.readFileSync('data/문항목록.csv', 'utf8'));
  const [header, ...expected] = csv;
  if (actual.length !== expected.length) throw new Error(`총 문항 불일치: ${actual.length} / ${expected.length}`);
  for (let i = 0; i < actual.length; i++) {
    for (let j = 0; j < header.length; j++) {
      if (String(actual[i][header[j]]) !== expected[i][j]) {
        throw new Error(`${i + 1}행 ${header[j]} 불일치: ${JSON.stringify(actual[i][header[j]])} / ${JSON.stringify(expected[i][j])}`);
      }
    }
  }
  console.log(`split.py CSV와 ${actual.length}문항 × ${header.length}열 일치`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
