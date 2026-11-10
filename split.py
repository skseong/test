"""원문 자료요구서 PDF를 문항별 CSV로 분해한다."""

import csv
import re
from datetime import date
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "원문"
OUTPUT = ROOT / "data" / "문항목록.csv"
FIELDS = ("파일명", "위원회", "의원", "제출기한", "문항번호", "요구내용", "세부항목", "비고")

HEADER = re.compile(r"^(\S+위원회)\s+(의원\S+)\s+의원실\s+자료요구서$")
DUE = re.compile(r"제출기한:\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.")
QUESTION = re.compile(r"^(\d+)\.\s*(.*)$")
DETAIL = re.compile(r"^[가나]\.\s*.*$")
EXPECTED = re.compile(r"_(\d+)문항\.pdf$")


def add_continuation(row, field, line):
    """줄바꿈으로 나뉜 문장을 직전 항목에 연결한다."""
    if field == "세부항목":
        parts = row["세부항목"]
        parts[-1] += " " + line
    elif field == "비고":
        parts = row["비고"]
        parts[-1] += " " + line
    else:
        row["요구내용"] += " " + line


def parse_pdf(path):
    header = None
    due_date = None
    questions = []
    current = None
    last_field = None

    for page in PdfReader(path).pages:
        for raw_line in (page.extract_text() or "").splitlines():
            line = raw_line.strip()
            if not line:
                continue

            if header is None:
                match = HEADER.fullmatch(line)
                if match:
                    header = match.groups()
                    continue

            if "제출기한:" in line:
                match = DUE.search(line)
                if not match:
                    raise ValueError(f"{path.name}: 제출기한 형식을 읽을 수 없습니다")
                due_date = date(*map(int, match.groups())).isoformat()

            # 이 줄에는 수신인, 보좌관 이름 또는 연락처가 함께 있을 수 있다.
            if line.startswith(("수신:", "담당 보좌관:", "끝.")):
                continue

            match = QUESTION.match(line)
            if match:
                current = {
                    "문항번호": int(match.group(1)),
                    "요구내용": match.group(2),
                    "세부항목": [],
                    "비고": [],
                }
                questions.append(current)
                last_field = "요구내용"
            elif DETAIL.match(line):
                if current is None:
                    raise ValueError(f"{path.name}: 문항 이전에 세부항목이 있습니다")
                current["세부항목"].append(line)
                last_field = "세부항목"
            elif line.startswith("※"):
                if current is None:
                    raise ValueError(f"{path.name}: 문항 이전에 비고가 있습니다")
                current["비고"].append(line)
                last_field = "비고"
            elif current is not None:
                add_continuation(current, last_field, line)
            else:
                raise ValueError(f"{path.name}: 분류할 수 없는 머리글이 있습니다")

    if header is None or due_date is None:
        raise ValueError(f"{path.name}: 위원회·의원 또는 제출기한이 없습니다")

    rows = []
    for question in questions:
        rows.append({
            "파일명": path.name,
            "위원회": header[0],
            "의원": header[1],
            "제출기한": due_date,
            "문항번호": question["문항번호"],
            "요구내용": question["요구내용"],
            "세부항목": " / ".join(question["세부항목"]),
            "비고": " / ".join(note.removeprefix("※").strip() for note in question["비고"]),
        })
    return rows


def main():
    paths = sorted(SOURCE.glob("*.pdf"))
    if len(paths) != 3:
        raise ValueError(f"원문 PDF는 3건이어야 합니다: {len(paths)}건")

    all_rows = []
    reports = []
    for path in paths:
        match = EXPECTED.search(path.name)
        if not match:
            raise ValueError(f"{path.name}: 파일명에서 문항 수를 읽을 수 없습니다")
        expected = int(match.group(1))
        rows = parse_pdf(path)
        numbers = [row["문항번호"] for row in rows]
        continuous = numbers == list(range(1, len(numbers) + 1))
        matched = expected == len(rows) and continuous
        reports.append((path.name, expected, len(rows), numbers[-1] if numbers else 0,
                        "O" if continuous else "X", "O" if matched else "X"))
        all_rows.extend(rows)

    print("파일명 | 파일명의 문항 수 | 뽑은 문항 수 | 마지막 번호 | 번호 연속 | 일치(O/X)")
    for report in reports:
        print(" | ".join(map(str, report)))
    if not all(report[-1] == "O" for report in reports):
        raise ValueError("문항 수 또는 번호가 원문 파일명과 일치하지 않습니다")

    with OUTPUT.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(all_rows)
    print(f"저장: {OUTPUT} ({len(all_rows)}문항)")


if __name__ == "__main__":
    main()
