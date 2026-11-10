const fs = require('node:fs');
const path = require('node:path');
const { load, classify, parseCsv } = require('./web/engine.js');

function readCases() {
  const source = fs.readFileSync(
    path.join(__dirname, 'data', '시험_요구문항_40건.csv'), 'utf8'
  );
  const [headers, ...rows] = parseCsv(source);
  const index = Object.fromEntries(headers.map((name, position) => [name, position]));
  for (const name of ['시험번호', '요구내용', '정답_배분과']) {
    if (index[name] === undefined) throw new Error(`시험 CSV 열이 없습니다: ${name}`);
  }
  return rows.map((row) => ({
    번호: row[index['시험번호']],
    내용: row[index['요구내용']],
    정답: row[index['정답_배분과']],
  }));
}

async function main() {
  await load();
  const cases = readCases();
  if (cases.length !== 40) throw new Error(`시험 문항이 40건이 아닙니다: ${cases.length}건`);

  let first = 0;
  let topThree = 0;
  const wrong = [];
  for (const item of cases) {
    const result = classify(item.내용);
    if (result[0]?.과 === item.정답) first++;
    else wrong.push({ ...item, 결과: result });
    if (result.some((candidate) => candidate.과 === item.정답)) topThree++;
  }

  console.log(`1순위 정답 ${first}/40 · 3순위 안 ${topThree}/40`);
  console.log('| 시험번호 | 요구내용 | 정답 | 엔진 결과 |');
  console.log('|---|---|---|---|');
  for (const item of wrong) {
    const result = item.결과.map((candidate) =>
      `${candidate.과}(${candidate.점수.toFixed(1)}, ${candidate.근거키워드})`
    ).join(' / ') || '후보 없음';
    console.log(`| ${item.번호} | ${item.내용} | ${item.정답} | ${result} |`);
  }
  if (wrong.length === 0) console.log('| 없음 | - | - | - |');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
