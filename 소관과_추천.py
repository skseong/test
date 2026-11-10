"""처리지침 제3장과 배분기준표에 따른 문항별 소관 과 후보 추천."""

import csv
from pathlib import Path


자료폴더 = Path(__file__).resolve().parent / "data"


def 소관과_추천(요구문항: str) -> dict:
    """문항 하나의 추천과·후보·근거를 반환한다. 배분 확정은 사람이 한다."""
    if not isinstance(요구문항, str) or not 요구문항.strip():
        raise ValueError("요구문항은 비어 있지 않은 문자열이어야 합니다.")

    with (자료폴더 / "A부_조직도_26개과.csv").open(
        encoding="utf-8-sig", newline=""
    ) as 파일:
        조직도 = {행["과"].strip() for 행 in csv.DictReader(파일)}

    문항 = 요구문항.casefold()
    적용규칙 = []
    제외규칙 = []
    with (자료폴더 / "배분기준표_소관키워드_304건.csv").open(
        encoding="utf-8-sig", newline=""
    ) as 파일:
        for 행 in csv.DictReader(파일):
            과 = 행["과"].strip()
            if 과 not in 조직도:
                raise ValueError(f"조직도에 없는 과가 기준표에 있습니다: {과}")
            키워드 = 행["키워드"].strip()
            if not 키워드 or 키워드.casefold() not in 문항:
                continue
            제외어 = [값.strip() for 값 in 행["제외어"].split("|") if 값.strip()]
            일치_제외어 = [값 for 값 in 제외어 if 값.casefold() in 문항]
            근거 = {
                "규칙": 행["rule_id"], "과": 과, "키워드": 키워드,
                "우선순위": int(행["우선순위"]), "유형": 행["유형"],
            }
            if 일치_제외어:
                제외규칙.append({**근거, "일치_제외어": 일치_제외어})
            else:
                적용규칙.append(근거)

    if not 적용규칙:
        return {
            "추천과": None, "후보과": [], "상태": "확인필요",
            "확인사유": "무일치", "배분구분": None,
            "적용규칙": [], "제외규칙": 제외규칙,
        }

    최고순위 = max(규칙["우선순위"] for 규칙 in 적용규칙)
    최고규칙 = [규칙 for 규칙 in 적용규칙 if 규칙["우선순위"] == 최고순위]
    후보과 = sorted({규칙["과"] for 규칙 in 최고규칙})
    유형 = {"공통" if 규칙["유형"].startswith("공통") else "소관" for 규칙 in 최고규칙}
    배분구분 = next(iter(유형)) if len(유형) == 1 else None
    확인사유 = "동순위" if len(후보과) > 1 else "공통" if 배분구분 == "공통" else None
    return {
        "추천과": 후보과[0] if len(후보과) == 1 else None,
        "후보과": 후보과,
        "상태": "확인필요" if 확인사유 else "추천",
        "확인사유": 확인사유,
        "배분구분": 배분구분,
        "적용규칙": sorted(적용규칙, key=lambda 규칙: (-규칙["우선순위"], 규칙["규칙"])),
        "제외규칙": 제외규칙,
    }


if __name__ == "__main__":
    with (자료폴더 / "시험_요구문항_40건.csv").open(
        encoding="utf-8-sig", newline=""
    ) as 파일:
        시험문항 = list(csv.DictReader(파일))
    정답수 = sum(
        소관과_추천(행["요구내용"])["추천과"] == 행["정답_배분과"]
        for 행 in 시험문항
    )
    print(f"1순위 정답: {정답수}/{len(시험문항)}")
