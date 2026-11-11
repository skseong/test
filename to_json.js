const fs = require('node:fs');
const path = require('node:path');

const input = path.join(__dirname, 'data', 'A부_조직도_26개과.csv');
const output = path.join(__dirname, 'org.json');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field === '') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (quoted) throw new Error('CSV 따옴표가 닫히지 않았습니다.');
  if (field !== '' || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows.filter((item) => item.some((value) => value !== ''));
}

const rows = parseCsv(fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, ''));
const headers = rows.shift();
const columns = ['실국', '과', '대표키워드'].map((name) => headers.indexOf(name));
if (columns.some((index) => index < 0)) {
  throw new Error('필요한 CSV 열이 없습니다: 실국, 과, 대표키워드');
}

const org = rows.map((row, index) => {
  if (row.length !== headers.length) {
    throw new Error(`${index + 2}행의 열 수가 머리글과 다릅니다.`);
  }
  return {
    실국: row[columns[0]],
    과: row[columns[1]],
    대표키워드: row[columns[2]].split('|').map((word) => word.trim()).filter(Boolean),
  };
});

fs.writeFileSync(output, JSON.stringify(org, null, 2) + '\n', 'utf8');
console.log(`원소 수: ${org.length}`);
console.log(`첫 원소: ${JSON.stringify(org[0])}`);
