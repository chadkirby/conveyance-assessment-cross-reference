from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CHAIN_PATH = ROOT / "chain-of-title.json"
CROSS_PATH = ROOT / "working" / "cross_reference_rows.json"
OUT_PATH = ROOT / "working" / "conveyance_assessment_data.json"


LEGAL_STOPWORDS = {
    "A",
    "AN",
    "AND",
    "AS",
    "AT",
    "BY",
    "CO",
    "COMPANY",
    "CORP",
    "CORPORATION",
    "ESTATE",
    "FOR",
    "FROM",
    "IN",
    "INC",
    "INCORPORATED",
    "L",
    "LIABILITY",
    "LIMITED",
    "LLC",
    "LP",
    "OF",
    "THE",
    "TO",
    "TRUST",
    "WASHINGTON",
}


def normalize_text(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9]+", " ", value.upper())).strip()


def token_set(value: str | None) -> set[str]:
    raw = normalize_text(value)
    if not raw:
        return set()
    return {tok for tok in raw.split(" ") if tok and tok not in LEGAL_STOPWORDS and len(tok) > 1}


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    union = a | b
    if not union:
        return 0.0
    return len(a & b) / len(union)


def pair_score(conveyance: dict[str, Any], cross_row: dict[str, Any]) -> float:
    grantor_score = jaccard(token_set(conveyance.get("grantor")), token_set(cross_row.get("grantor")))
    grantee_score = jaccard(token_set(conveyance.get("grantee")), token_set(cross_row.get("grantee")))
    return 0.2 + (0.4 * grantor_score) + (0.4 * grantee_score)


def parse_mmddyyyy(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.strptime(value.strip(), "%m/%d/%Y")
    except ValueError:
        return None


def due_value(label: str | None) -> bool | None:
    if not label:
        return None
    clean = label.strip().lower()
    if clean == "yes":
        return True
    if clean == "no":
        return False
    return None


def parse_lot(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, int):
        return value
    text = str(value).strip()
    if not text:
        return None
    digits = "".join(ch for ch in text if ch.isdigit())
    if not digits:
        return None
    return int(digits)


def best_assignment(
    conveyances: list[dict[str, Any]],
    rows: list[dict[str, Any]],
) -> list[int | None]:
    score_matrix: list[list[float]] = []
    for conveyance in conveyances:
        score_matrix.append([pair_score(conveyance, row) for row in rows])

    memo: dict[tuple[int, int], tuple[float, list[int | None]]] = {}

    def solve(c_idx: int, used_mask: int) -> tuple[float, list[int | None]]:
        key = (c_idx, used_mask)
        if key in memo:
            return memo[key]
        if c_idx >= len(conveyances):
            return 0.0, []

        best_score_value, best_mapping = solve(c_idx + 1, used_mask)
        best_mapping = [None, *best_mapping]

        for r_idx, score in enumerate(score_matrix[c_idx]):
            if used_mask & (1 << r_idx):
                continue
            downstream_score, downstream_mapping = solve(c_idx + 1, used_mask | (1 << r_idx))
            total = score + downstream_score
            if total > best_score_value:
                best_score_value = total
                best_mapping = [r_idx, *downstream_mapping]

        memo[key] = (best_score_value, best_mapping)
        return memo[key]

    _score, mapping = solve(0, 0)

    if len(conveyances) == 1 and len(rows) == 1 and mapping == [None]:
        return [0]

    return mapping


def main() -> None:
    chain_data = json.loads(CHAIN_PATH.read_text(encoding="utf-8"))
    cross_data = json.loads(CROSS_PATH.read_text(encoding="utf-8"))

    cross_rows_raw = cross_data.get("rows", [])
    cross_rows: list[dict[str, Any]] = []
    for idx, row in enumerate(cross_rows_raw):
        lot = parse_lot(row.get("lot"))
        deed_date = (row.get("deedDate") or "").strip()
        if lot is None or not deed_date:
            continue
        enriched = dict(row)
        enriched["_rowId"] = idx
        enriched["_lot"] = lot
        enriched["_deedDate"] = deed_date
        cross_rows.append(enriched)

    grouped_rows: dict[tuple[int, str], list[dict[str, Any]]] = defaultdict(list)
    rows_by_lot: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in cross_rows:
        grouped_rows[(row["_lot"], row["_deedDate"])].append(row)
        rows_by_lot[row["_lot"]].append(row)

    assigned_row_ids: set[int] = set()

    lots_output: list[dict[str, Any]] = []
    for lot_entry in chain_data:
        lot_num = parse_lot(lot_entry.get("lot"))
        conveyances = lot_entry.get("conveyances", [])

        grouped_conveyances: dict[tuple[int, str], list[dict[str, Any]]] = defaultdict(list)
        for idx, conveyance in enumerate(conveyances):
            date_text = (conveyance.get("date") or "").strip()
            if lot_num is None or not date_text:
                continue
            grouped_conveyances[(lot_num, date_text)].append({"index": idx, **conveyance})

        assessment_by_index: dict[int, dict[str, Any]] = {}
        for key, group_conveyances in grouped_conveyances.items():
            rows_for_key = [row for row in grouped_rows.get(key, []) if row["_rowId"] not in assigned_row_ids]
            if not rows_for_key:
                continue

            mapping = best_assignment(group_conveyances, rows_for_key)
            for g_idx, mapped_row_idx in enumerate(mapping):
                if mapped_row_idx is None:
                    continue
                row = rows_for_key[mapped_row_idx]
                row_id = row["_rowId"]
                if row_id in assigned_row_ids:
                    continue
                assigned_row_ids.add(row_id)
                conveyance_index = group_conveyances[g_idx]["index"]
                assessment_by_index[conveyance_index] = {
                    "crossReferenceRowId": row_id,
                    "category": row.get("category") or "",
                    "dueLabel": row.get("due500") or "",
                    "assessmentDue": due_value(row.get("due500")),
                    "expectedAmount": row.get("expectedAmount"),
                    "collectedAmount": row.get("actualNetAmount"),
                    "impact": row.get("impact"),
                    "matchStatus": row.get("matchStatus") or "",
                    "glDate": row.get("glDate") or "",
                    "glUnit": row.get("glUnit"),
                    "glDescription": row.get("glDescription") or "",
                    "notes": row.get("notes") or "",
                }

        # Second pass: same lot, name-based matching when dates diverge between datasets.
        if lot_num is not None:
            open_conveyances = [
                {"index": idx, **conveyance}
                for idx, conveyance in enumerate(conveyances)
                if idx not in assessment_by_index
            ]
            open_rows = [row for row in rows_by_lot.get(lot_num, []) if row["_rowId"] not in assigned_row_ids]

            candidate_pairs: list[tuple[float, int, dict[str, Any]]] = []
            for conveyance in open_conveyances:
                conveyance_date = parse_mmddyyyy(conveyance.get("date"))
                for row in open_rows:
                    score = pair_score(conveyance, row)
                    row_date = parse_mmddyyyy(row.get("deedDate"))
                    if conveyance_date and row_date:
                        day_delta = abs((conveyance_date - row_date).days)
                        if day_delta <= 45:
                            score += 0.08
                    if score >= 0.72:
                        candidate_pairs.append((score, conveyance["index"], row))

            used_conveyance_indexes: set[int] = set()
            for _score, conveyance_index, row in sorted(candidate_pairs, key=lambda item: item[0], reverse=True):
                row_id = row["_rowId"]
                if row_id in assigned_row_ids or conveyance_index in used_conveyance_indexes:
                    continue
                assigned_row_ids.add(row_id)
                used_conveyance_indexes.add(conveyance_index)
                assessment_by_index[conveyance_index] = {
                    "crossReferenceRowId": row_id,
                    "category": row.get("category") or "",
                    "dueLabel": row.get("due500") or "",
                    "assessmentDue": due_value(row.get("due500")),
                    "expectedAmount": row.get("expectedAmount"),
                    "collectedAmount": row.get("actualNetAmount"),
                    "impact": row.get("impact"),
                    "matchStatus": row.get("matchStatus") or "",
                    "glDate": row.get("glDate") or "",
                    "glUnit": row.get("glUnit"),
                    "glDescription": row.get("glDescription") or "",
                    "notes": row.get("notes") or "",
                }

        enriched_conveyances: list[dict[str, Any]] = []
        for idx, conveyance in enumerate(conveyances):
            enriched = dict(conveyance)
            enriched["assessment"] = assessment_by_index.get(idx)
            enriched_conveyances.append(enriched)

        lot_unmatched_rows = []
        if lot_num is not None:
            for row in cross_rows:
                if row["_rowId"] in assigned_row_ids:
                    continue
                if row["_lot"] != lot_num:
                    continue
                lot_unmatched_rows.append(
                    {
                        "crossReferenceRowId": row["_rowId"],
                        "deedDate": row.get("deedDate") or "",
                        "deedType": row.get("deedType") or "",
                        "grantor": row.get("grantor") or "",
                        "grantee": row.get("grantee") or "",
                        "matchStatus": row.get("matchStatus") or "",
                        "category": row.get("category") or "",
                        "expectedAmount": row.get("expectedAmount"),
                        "collectedAmount": row.get("actualNetAmount"),
                        "glDate": row.get("glDate") or "",
                        "glDescription": row.get("glDescription") or "",
                        "notes": row.get("notes") or "",
                    }
                )

        lots_output.append(
            {
                "lot": lot_entry.get("lot"),
                "parcelNumber": lot_entry.get("parcelNumber"),
                "phase": lot_entry.get("phase"),
                "conveyances": enriched_conveyances,
                "unmatchedCrossRows": lot_unmatched_rows,
            }
        )

    unmatched_gl_rows = cross_data.get("unmatchedGlRows", [])

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "lots": lots_output,
        "unmatchedGlRows": unmatched_gl_rows,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote conveyance assessment data: {OUT_PATH}")


if __name__ == "__main__":
    main()
