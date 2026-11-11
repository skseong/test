/* split.py의 문항 경계·세부항목·비고 규칙을 브라우저에서 적용한다. */
(function (root) {
  'use strict';
  const HEADER = /^(\S+위원회)\s+(의원\S+)\s+의원실\s+자료요구서$/;
  const DUE = /제출기한:\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\./;
  const QUESTION = /^(\d+)\.\s*(.*)$/;
  const DETAIL = /^[가나]\.\s*.*$/;

  function parseLines(lines, filename) {
    let header = null, due = null, current = null, lastField = null;
    const questions = [];
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (!header) {
        const match = line.match(HEADER);
        if (match) { header = [match[1], match[2]]; continue; }
      }
      if (line.includes('제출기한:')) {
        const match = line.match(DUE);
        if (!match) throw new Error(`${filename}: 제출기한 형식을 읽을 수 없습니다.`);
        const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
        const date = new Date(Date.UTC(year, month - 1, day));
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
          throw new Error(`${filename}: 제출기한이 유효하지 않습니다.`);
        }
        due = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
      if (/^(수신:|담당 보좌관:|끝\.)/.test(line)) continue;
      const match = line.match(QUESTION);
      if (match) {
        current = { 문항번호: Number(match[1]), 요구내용: match[2], 세부항목: [], 비고: [] };
        questions.push(current);
        lastField = '요구내용';
      } else if (DETAIL.test(line)) {
        if (!current) throw new Error(`${filename}: 문항 이전에 세부항목이 있습니다.`);
        current.세부항목.push(line);
        lastField = '세부항목';
      } else if (line.startsWith('※')) {
        if (!current) throw new Error(`${filename}: 문항 이전에 비고가 있습니다.`);
        current.비고.push(line);
        lastField = '비고';
      } else if (current) {
        if (lastField === '요구내용') current.요구내용 += ` ${line}`;
        else current[lastField][current[lastField].length - 1] += ` ${line}`;
      } else {
        throw new Error(`${filename}: 분류할 수 없는 머리글이 있습니다.`);
      }
    }
    if (!header || !due) throw new Error(`${filename}: 위원회·의원 또는 제출기한이 없습니다.`);
    const numbers = questions.map((q) => q.문항번호);
    if (numbers.some((n, i) => n !== i + 1)) throw new Error(`${filename}: 문항번호가 1부터 연속되지 않습니다.`);
    const expected = filename.match(/_(\d+)문항\.pdf$/i);
    if (expected && Number(expected[1]) !== questions.length) {
      throw new Error(`${filename}: 파일명 ${expected[1]}문항과 추출 ${questions.length}문항이 다릅니다.`);
    }
    return questions.map((q) => ({
      파일명: filename, 위원회: header[0], 의원: header[1], 제출기한: due,
      문항번호: q.문항번호, 요구내용: q.요구내용,
      세부항목: q.세부항목.join(' / '),
      비고: q.비고.map((note) => note.replace(/^※\s*/, '')).join(' / ')
    }));
  }

  function linesFromItems(items) {
    const lines = [];
    let line = null;
    for (const item of items) {
      const y = item.transform[5];
      if (!line || Math.abs(y - line.y) > 2) {
        line = { y, items: [] };
        lines.push(line);
      }
      line.items.push(item);
    }
    return lines.map(({ items: parts }) => {
      parts.sort((a, b) => a.transform[4] - b.transform[4]);
      let text = '', end = -Infinity;
      for (const part of parts) {
        const x = part.transform[4];
        if (text && x - end > 2 && !/\s$/.test(text) && !/^\s/.test(part.str)) text += ' ';
        text += part.str;
        end = x + (part.width || 0);
      }
      return text;
    });
  }

  async function parsePdf(file) {
    if (!root.pdfjsLib) throw new Error('pdf.js를 읽지 못했습니다.');
    const document = await root.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const lines = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      lines.push(...linesFromItems(content.items));
    }
    return parseLines(lines, file.name);
  }

  root.RequestSplit = { parseLines, parsePdf, linesFromItems };
})(globalThis);
