#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any


SOURCE_FILE_MAP = {
    "4414 Deeds": "Deschutes Heights 4414 Deeds",
    "Phase 1 File": "Deschutes Heights Phase 1 Deeds",
    "Phase 2 File": "Deschutes Heights Phase 2 Deeds",
}


def normalize_space(text: str | None) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", text).strip()


def parse_lot(value: Any) -> int | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    if s.isdigit():
        return int(s)
    m = re.search(r"\d+", s)
    return int(m.group(0)) if m else None


def phase_for_lot(lot: int) -> str:
    if lot <= 26:
        return "I"
    if lot <= 66:
        return "II"
    return "III"


def deed_type_enum(value: str | None) -> str:
    t = normalize_space(value).lower()
    if "quit" in t:
        return "QUIT_CLAIM"
    if "non-merger statutory warranty" in t or ("deed in lieu" in t and "warranty" in t):
        return "DEED_IN_LIEU_STATUTORY_WARRANTY"
    if "statutory warranty" in t:
        return "STATUTORY_WARRANTY"
    if "warranty" in t:
        return "WARRANTY"
    return "OTHER"


def parse_date(value: str | None) -> datetime | None:
    s = normalize_space(value)
    if not s:
        return None
    for fmt in ("%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def source_file_label(value: str | None) -> str:
    raw = normalize_space(value)
    return SOURCE_FILE_MAP.get(raw, raw)


def extract_parcels(value: str | None) -> list[int]:
    text = normalize_space(value)
    if not text:
        return []
    found: list[int] = []
    for m in re.finditer(r"\b4414[- ]?\d{2}[- ]?\d{5}\b", text):
        digits = re.sub(r"[^0-9]", "", m.group(0))
        if len(digits) == 11 and digits.startswith("4414"):
            found.append(int(digits))
    for m in re.finditer(r"\b4414\d{7}\b", text):
        digits = m.group(0)
        found.append(int(digits))
    # preserve order, remove duplicates
    unique: list[int] = []
    seen = set()
    for p in found:
        if p not in seen:
            seen.add(p)
            unique.append(p)
    return unique


def parcel_for_lot(lot: int, lot_records: list[dict[str, Any]]) -> int:
    candidates: list[int] = []
    for r in lot_records:
        for p in extract_parcels(r.get("taxParcel")):
            lot_part = (p // 100) % 1000
            if lot_part == lot:
                candidates.append(p)
    if candidates:
        # most frequent matching parcel for this lot
        freq: dict[int, int] = defaultdict(int)
        for p in candidates:
            freq[p] += 1
        return sorted(freq.items(), key=lambda x: (-x[1], x[0]))[0][0]
    return int(f"441400{lot:03d}00")


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    deeds_path = root / "all_deeds_final.json"
    out_path = root / "chain-of-title.json"
    summary_path = root / "working" / "chain-of-title-summary.json"
    summary_path.parent.mkdir(exist_ok=True)

    deeds: list[dict[str, Any]] = json.loads(deeds_path.read_text(encoding="utf-8"))

    by_lot: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in deeds:
        lot = parse_lot(row.get("lot"))
        if lot is None or lot <= 0:
            continue
        by_lot[lot].append(row)

    chain: list[dict[str, Any]] = []
    for lot in sorted(by_lot.keys()):
        records = by_lot[lot]
        conveyances_raw = []
        for r in records:
            date_str = normalize_space(r.get("normalizedDate"))
            if not date_str:
                continue
            page = int(r.get("page") or 0)
            conveyances_raw.append(
                {
                    "date": date_str,
                    "dateObj": parse_date(date_str),
                    "deedType": deed_type_enum(r.get("deedType")),
                    "grantor": normalize_space(r.get("grantor")),
                    "grantee": normalize_space(r.get("grantee")),
                    "sourceFile": source_file_label(r.get("source")),
                    "sourcePage": page if page > 0 else None,
                    "_recording": normalize_space(str(r.get("recordingNumber") or "")),
                    "_source": normalize_space(str(r.get("source") or "")),
                    "_page": page,
                }
            )

        # dedupe conveyances for the same lot by core fields
        grouped: dict[tuple[str, str, str, str, str], dict[str, Any]] = {}
        for c in sorted(
            conveyances_raw,
            key=lambda x: (
                x["dateObj"] or datetime.max,
                x["_recording"],
                x["_source"],
                x["_page"],
            ),
        ):
            key = (c["date"], c["deedType"], c["grantor"], c["grantee"], c["sourceFile"])
            if key not in grouped:
                grouped[key] = {
                    "date": c["date"],
                    "deedType": c["deedType"],
                    "grantor": c["grantor"],
                    "grantee": c["grantee"],
                    "sourceFile": c["sourceFile"],
                    "sourcePages": [],
                }
            p = c.get("sourcePage")
            if isinstance(p, int) and p > 0 and p not in grouped[key]["sourcePages"]:
                grouped[key]["sourcePages"].append(p)

        conveyances = sorted(
            grouped.values(),
            key=lambda x: (
                parse_date(x["date"]) or datetime.max,
                x["sourceFile"],
                x["grantor"],
                x["grantee"],
            ),
        )
        for c in conveyances:
            c["sourcePages"] = sorted(c["sourcePages"])

        if not conveyances:
            continue

        chain.append(
            {
                "lot": lot,
                "parcelNumber": parcel_for_lot(lot, records),
                "phase": phase_for_lot(lot),
                "conveyances": conveyances,
            }
        )

    out_path.write_text(json.dumps(chain, indent=2), encoding="utf-8")

    summary = {
        "lots": len(chain),
        "totalConveyances": sum(len(x["conveyances"]) for x in chain),
        "deedSourceCount": len(deeds),
        "output": str(out_path),
    }
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(f"Wrote: {out_path}")
    print(f"Wrote summary: {summary_path}")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
