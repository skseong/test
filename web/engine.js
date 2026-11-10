/* Node: await require('./web/engine.js').load(); 브라우저: await RequestEngine.load(); */
(function (root) {
  'use strict';

  const files = {
    rules: 'rules_보강.csv',
    org: 'A부_조직도_26개과.csv',
  };
  const browserScriptUrl = typeof document === 'undefined'
    ? null
    : (document.currentScript && document.currentScript.src) || document.baseURI;
  let rules = null;
  let departments = null;

  function parseCsv(text) {
    const papa = typeof module !== 'undefined' && module.exports
      ? require('./lib/papaparse.min.js') : root.Papa;
    if (!papa) throw new Error('Papa Parse를 읽지 못했습니다.');
    const result = papa.parse(text.replace(/^\uFEFF/, ''), {
      delimiter: ',', skipEmptyLines: 'greedy', dynamicTyping: false
    });
    if (result.errors.length) {
      throw new Error(`CSV ${result.errors[0].row + 1}행 읽기 오류: ${result.errors[0].message}`);
    }
    return result.data;
  }

  function records(text, required) {
    const rows = parseCsv(text);
    if (rows.length === 0) throw new Error('CSV가 비어 있습니다.');
    const headers = rows.shift();
    for (const name of required) {
      if (!headers.includes(name)) throw new Error(`CSV 열이 없습니다: ${name}`);
    }
    return rows.map((row, index) => {
      if (row.length !== headers.length) {
        throw new Error(`CSV ${index + 2}행의 열 수가 맞지 않습니다.`);
      }
      return Object.fromEntries(headers.map((name, column) => [name, row[column]]));
    });
  }

  async function readCsv(name) {
    if (typeof module !== 'undefined' && module.exports) {
      const fs = require('node:fs/promises');
      const path = require('node:path');
      return fs.readFile(path.resolve(__dirname, '..', 'data', name), 'utf8');
    }
    const url = new URL(`data/${name}`, browserScriptUrl);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`CSV를 읽을 수 없습니다: ${url} (${response.status})`);
    return response.text();
  }

  async function load({ rulesFile = files.rules } = {}) {
    if (typeof rulesFile !== 'string' || !/^[^/\\]+\.csv$/.test(rulesFile)) {
      throw new Error('rulesFile에는 data 폴더의 CSV 파일명만 지정하세요.');
    }
    const [ruleText, orgText] = await Promise.all([
      readCsv(rulesFile),
      readCsv(files.org),
    ]);
    const orgRows = records(orgText, ['과']);
    const ruleRows = records(ruleText, ['과', '키워드', '제외어', '우선순위']);
    const validDepartments = new Set(orgRows.map((row) => row['과'].trim()).filter(Boolean));
    const parsedRules = ruleRows.map((row, index) => {
      const priority = Number(row['우선순위']);
      if (!Number.isFinite(priority)) {
        throw new Error(`기준표 ${index + 2}행의 우선순위가 숫자가 아닙니다.`);
      }
      return {
        department: row['과'].trim(),
        keyword: row['키워드'].trim(),
        exclusions: row['제외어'].split('|').map((word) => word.trim())
          .filter((word) => word && word !== '-'),
        priority,
      };
    });
    departments = validDepartments;
    rules = parsedRules;
    return { 규칙수: rules.length, 부서수: departments.size };
  }

  function classify(요구내용) {
    if (rules === null || departments === null) {
      throw new Error('먼저 await load()로 기준표와 조직도를 읽으세요.');
    }
    if (typeof 요구내용 !== 'string') throw new TypeError('요구내용은 문자열이어야 합니다.');
    const text = 요구내용.toLocaleLowerCase();
    const byDepartment = new Map();

    for (const rule of rules) {
      if (!departments.has(rule.department) || !rule.keyword) continue;
      if (!text.includes(rule.keyword.toLocaleLowerCase())) continue;
      if (rule.exclusions.some((word) => text.includes(word.toLocaleLowerCase()))) continue;

      const score = rule.priority + rule.keyword.length / 10;
      const previous = byDepartment.get(rule.department);
      if (!previous || score > previous.점수 ||
          (score === previous.점수 && rule.keyword < previous.근거키워드)) {
        byDepartment.set(rule.department, {
          과: rule.department,
          점수: score,
          우선순위: rule.priority,
          근거키워드: rule.keyword,
        });
      }
    }

    return [...byDepartment.values()]
      .sort((a, b) => b.우선순위 - a.우선순위 || b.점수 - a.점수 ||
        (a.과 < b.과 ? -1 : a.과 > b.과 ? 1 : 0))
      .slice(0, 3);
  }

  const api = { load, classify, parseCsv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RequestEngine = api;
})(globalThis);
