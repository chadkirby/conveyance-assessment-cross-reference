#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any


AMENDMENT_DATE = date(2021, 1, 11)

SOURCE_FILES = {
    "4414 Deeds": "Deschutes Heights 4414 Deeds.md",
    "Phase 1 File": "Deschutes Heights Phase 1 Deeds.md",
    "Phase 2 File": "Deschutes Heights Phase 2 Deeds.md",
}


@dataclass
class ParsedPageDeed:
    source: str
    page: int
    lot: int
    phase: str
    deed_type: str
    grantor: str
    grantee: str
    date_raw: str
    normalized_date: str
    tax_parcel: str
    recording_number: str
    excise_tax: str
    consideration: str
    related_lots: list[int]
    derived_from: str


def normalize_space(text: str | None) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", text).strip()


def parse_pages(path: Path) -> dict[int, str]:
    content = path.read_text(encoding="utf-8", errors="ignore")
    markers = list(re.finditer(r"<!-- PAGE (\d+) -->", content))
    pages: dict[int, str] = {}
    for i, m in enumerate(markers):
        page = int(m.group(1))
        start = m.start()
        end = markers[i + 1].start() if i + 1 < len(markers) else len(content)
        pages[page] = content[start:end]
    return pages


def phase_from_lot(lot: int) -> str:
    if lot <= 26:
        return "I (Original)"
    if lot <= 66:
        return "II"
    return "III"


def normalize_year(raw: str) -> int:
    y = int(raw)
    if y < 100:
        return 2000 + y if y < 50 else 1900 + y
    return y


def format_date(m: int, d: int, y: int) -> str:
    return f"{m:02d}/{d:02d}/{y:04d}"


def extract_date(chunk: str) -> tuple[str, str]:
    month_map = {
        "jan": 1,
        "january": 1,
        "feb": 2,
        "february": 2,
        "mar": 3,
        "march": 3,
        "apr": 4,
        "april": 4,
        "may": 5,
        "jun": 6,
        "june": 6,
        "jul": 7,
        "july": 7,
        "aug": 8,
        "august": 8,
        "sep": 9,
        "sept": 9,
        "september": 9,
        "oct": 10,
        "october": 10,
        "nov": 11,
        "november": 11,
        "dec": 12,
        "december": 12,
    }

    m = re.search(r"\bDated[:\s]+(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b", chunk, flags=re.IGNORECASE)
    if m:
        mm, dd, yy = int(m.group(1)), int(m.group(2)), normalize_year(m.group(3))
        return format_date(mm, dd, yy), m.group(0)

    m = re.search(r"\bDated[:\s]+([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{2,4})\b", chunk, flags=re.IGNORECASE)
    if m:
        month = month_map.get(m.group(1).lower())
        if month:
            return format_date(month, int(m.group(2)), normalize_year(m.group(3))), m.group(0)

    m = re.search(
        r"\bDated\s+this\s+(\d{1,2})(?:st|nd|rd|th)?\s+day\s+of\s+([A-Za-z]+),?\s+(\d{4})\b",
        chunk,
        flags=re.IGNORECASE,
    )
    if m:
        month = month_map.get(m.group(2).lower())
        if month:
            return format_date(month, int(m.group(1)), int(m.group(3))), m.group(0)

    m = re.search(
        r"\b(\d{1,2})/(\d{1,2})/(\d{4})\s+\d{1,2}:\d{2}\s*(?:AM|PM)\b",
        chunk,
        flags=re.IGNORECASE,
    )
    if m:
        return format_date(int(m.group(1)), int(m.group(2)), int(m.group(3))), m.group(0)

    return "", ""


def extract_recording_number(chunk: str) -> str:
    patterns = [
        r"\b(\d{7})\s+\d{1,2}/\d{1,2}/\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM)\b",
        r"\b(\d{7})\s+Page\s+\d+\s+of\s+\d+",
        r"\b(\d{7})\s+Pages?:\s*\d+",
    ]
    for pat in patterns:
        m = re.search(pat, chunk, flags=re.IGNORECASE)
        if m:
            return m.group(1)
    return ""


def extract_deed_type(chunk: str) -> str:
    if re.search(r"\bQUIT CLAIM DEED\b", chunk, flags=re.IGNORECASE):
        return "Quit Claim Deed"
    if re.search(r"\bSTATUTORY WARRANTY DEED\b", chunk, flags=re.IGNORECASE):
        return "Statutory Warranty Deed"
    if re.search(r"\bWARRANTY DEED\b", chunk, flags=re.IGNORECASE):
        return "Warranty Deed"
    return "Deed"


def extract_grantor_grantee(chunk: str) -> tuple[str, str]:
    m_table_g = re.search(
        r"<td>\s*Grantor(?:\(s\))?\s*:\s*</td>\s*<td>\s*([^<]+?)\s*</td>",
        chunk,
        flags=re.IGNORECASE | re.DOTALL,
    )
    m_table_gg = re.search(
        r"<td>\s*Grantee(?:\(s\))?\s*:\s*</td>\s*<td>\s*([^<]+?)\s*</td>",
        chunk,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if m_table_g and m_table_gg:
        return normalize_space(m_table_g.group(1)), normalize_space(m_table_gg.group(1))

    m_g = re.search(r"Grantor\(s\):\s*(.+)", chunk, flags=re.IGNORECASE)
    m_gg = re.search(r"Grantee\(s\):\s*(.+)", chunk, flags=re.IGNORECASE)
    if m_g and m_gg:
        return normalize_space(m_g.group(1)), normalize_space(m_gg.group(1))

    m_g = re.search(r"\bGrantor:\s*(.+)", chunk, flags=re.IGNORECASE)
    m_gg = re.search(r"\bGrantee:\s*(.+)", chunk, flags=re.IGNORECASE)
    if m_g and m_gg:
        return normalize_space(m_g.group(1)), normalize_space(m_gg.group(1))

    m = re.search(
        r"THE\s+GRANTOR\s+(.+?)\s+for\s+and\s+in\s+consideration[\s\S]{0,900}?\s+to\s+(.+?)\s+the\s+following\s+described",
        chunk,
        flags=re.IGNORECASE,
    )
    if m:
        return normalize_space(m.group(1)), normalize_space(m.group(2))

    m = re.search(
        r"The\s+Grantor,?\s+(.+?)\s+for\s+and\s+in\s+consideration[\s\S]{0,900}?\s+to\s+(.+?)\s+the\s+following\s+described",
        chunk,
        flags=re.IGNORECASE,
    )
    if m:
        return normalize_space(m.group(1)), normalize_space(m.group(2))

    m = re.search(
        r"made\s+by\s+and\s+between\s+(.+?),\s*(?:whose address|\"?\(Grantor\))[\s\S]{0,400}?\sand\s+(.+?),\s*(?:whose address|\"?\(Grantee\))",
        chunk,
        flags=re.IGNORECASE,
    )
    if m:
        return normalize_space(m.group(1)), normalize_space(m.group(2))

    return "", ""


def extract_tax_parcels(chunk: str) -> list[str]:
    parcels: set[str] = set()
    for m in re.finditer(r"\b4414[- ]?\d{2}[- ]?\d{5}\b", chunk):
        parcels.add(m.group(0).replace(" ", ""))
    for m in re.finditer(r"\b4414\d{7}\b", chunk):
        parcels.add(m.group(0))
    return sorted(parcels)


def extract_lots_from_parcels(parcels: list[str]) -> list[int]:
    lots: set[int] = set()
    for p in parcels:
        digits = re.sub(r"[^0-9]", "", p)
        if len(digits) == 11 and digits.startswith("4414"):
            lot = int(digits[6:9])
            if 0 < lot <= 500:
                lots.add(lot)
    return sorted(lots)


def extract_lots_from_legal(chunk: str) -> list[int]:
    lots: set[int] = set()
    legal_lines = []
    for m in re.finditer(r"(Abbreviated Legal:.*|LOT[S]?\s+[^.\n]+)", chunk, flags=re.IGNORECASE):
        legal_lines.append(m.group(0))
    for line in legal_lines:
        for m in re.finditer(r"\bLOT(?:S)?\s+([0-9,&\sand]+)", line, flags=re.IGNORECASE):
            text = m.group(1)
            for num in re.findall(r"\d{1,3}", text):
                n = int(num)
                if 0 < n <= 500:
                    lots.add(n)
    return sorted(lots)


def parse_source_pages(source_name: str, pages: dict[int, str]) -> list[ParsedPageDeed]:
    deeds: list[ParsedPageDeed] = []
    sorted_pages = sorted(pages.keys())
    for page in sorted_pages:
        p0 = pages.get(page, "")
        p1 = pages.get(page + 1, "")
        chunk = f"{p0}\n{p1}"
        if "DEED" not in p0.upper():
            continue
        m_page = re.search(r"\bPage\s+(\d+)\s+of\s+(\d+)\b", p0, flags=re.IGNORECASE)
        if m_page and int(m_page.group(1)) > 1:
            continue

        deed_type = extract_deed_type(p0)
        recording = extract_recording_number(p0) or extract_recording_number(chunk)
        grantor, grantee = extract_grantor_grantee(p0)
        start_markers = ("When recorded return to", "THE GRANTOR", "Grantor:", "Grantor(s):")
        if (not grantor or not grantee) and p1 and any(marker in p0 for marker in start_markers):
            g0, g1 = extract_grantor_grantee(chunk)
            grantor = grantor or g0
            grantee = grantee or g1
        if not normalize_space(grantor) or not normalize_space(grantee):
            continue
        normalized_date, raw_date = extract_date(p0)
        if not normalized_date:
            normalized_date, raw_date = extract_date(chunk)
        parcels = extract_tax_parcels(p0)
        if not parcels:
            parcels = extract_tax_parcels(chunk)
        lots = extract_lots_from_parcels(parcels)
        if not lots:
            lots = extract_lots_from_legal(p0)
        if not lots:
            lots = extract_lots_from_legal(chunk)
        if not lots:
            continue

        for lot in lots:
            deeds.append(
                ParsedPageDeed(
                    source=source_name,
                    page=page,
                    lot=lot,
                    phase=phase_from_lot(lot),
                    deed_type=deed_type,
                    grantor=grantor,
                    grantee=grantee,
                    date_raw=raw_date,
                    normalized_date=normalized_date,
                    tax_parcel=parcels[0] if parcels else "",
                    recording_number=recording,
                    excise_tax="",
                    consideration="",
                    related_lots=lots,
                    derived_from="page_scan",
                )
            )
    return deeds


def parse_existing_deeds_with_related_lots(
    deeds: list[dict[str, Any]], page_maps: dict[str, dict[int, str]]
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[tuple[str, int, str, int]] = set()

    for deed in deeds:
        source = deed.get("source", "")
        page = int(deed.get("page", 0) or 0)
        lot_raw = deed.get("lot")
        lot = int(lot_raw) if str(lot_raw).isdigit() else None
        if not source or source not in page_maps or not page:
            if lot is not None:
                key = (source, page, str(deed.get("recordingNumber", "")), lot)
                if key not in seen:
                    seen.add(key)
                    copy = dict(deed)
                    copy["relatedLots"] = [lot]
                    copy["isPostAmendment"] = bool(
                        deed.get("normalizedDate") and _is_post_amendment(str(deed.get("normalizedDate")))
                    )
                    out.append(copy)
            continue

        page0 = page_maps[source].get(page, "")
        page1 = page_maps[source].get(page + 1, "")
        if re.search(r"Tax Parcel|Assessor.?s Tax Parcel", page0, flags=re.IGNORECASE):
            chunk = page0
        else:
            chunk = f"{page0}\n{page1}"
        parcels = extract_tax_parcels(chunk)
        related_lots = extract_lots_from_parcels(parcels)
        if lot is not None and lot not in related_lots:
            related_lots.append(lot)
        if not related_lots and lot is not None:
            related_lots = [lot]
        related_lots = sorted(set(related_lots))

        recording = str(deed.get("recordingNumber", "")).strip()
        if not recording:
            recording = extract_recording_number(chunk)

        normalized_date = str(deed.get("normalizedDate", "")).strip()
        date_raw = str(deed.get("date", "")).strip()
        if not normalized_date:
            normalized_date, date_raw_guess = extract_date(chunk)
            if not date_raw and date_raw_guess:
                date_raw = date_raw_guess

        grantor = normalize_space(str(deed.get("grantor", "")))
        grantee = normalize_space(str(deed.get("grantee", "")))
        if not grantor or not grantee:
            g0, g1 = extract_grantor_grantee(chunk)
            if not grantor:
                grantor = g0
            if not grantee:
                grantee = g1

        deed_type = str(deed.get("deedType", "")).strip() or extract_deed_type(chunk)

        for related_lot in related_lots:
            record = dict(deed)
            record["lot"] = str(related_lot)
            record["phase"] = phase_from_lot(related_lot)
            record["recordingNumber"] = recording
            record["deedType"] = deed_type
            record["grantor"] = grantor
            record["grantee"] = grantee
            record["date"] = date_raw
            record["normalizedDate"] = normalized_date
            record["taxParcel"] = record.get("taxParcel", "") or (parcels[0] if parcels else "")
            record["relatedLots"] = related_lots
            record["isPostAmendment"] = _is_post_amendment(normalized_date)
            if related_lot != lot:
                record["derivedFrom"] = "existing_record_related_lot"
            key = (source, page, recording, related_lot)
            if key in seen:
                continue
            seen.add(key)
            out.append(record)
    return out


def _is_post_amendment(normalized_date: str) -> bool:
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", normalized_date or "")
    if not m:
        return False
    mm, dd, yy = int(m.group(1)), int(m.group(2)), int(m.group(3))
    try:
        return date(yy, mm, dd) >= AMENDMENT_DATE
    except ValueError:
        return False


def dedupe_deeds(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    def score(r: dict[str, Any]) -> tuple[int, int, int, int]:
        return (
            1 if r.get("normalizedDate") else 0,
            len(normalize_space(r.get("grantor"))),
            len(normalize_space(r.get("grantee"))),
            1 if r.get("recordingNumber") else 0,
        )

    grouped: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    for r in records:
        source = str(r.get("source", ""))
        lot = str(r.get("lot", ""))
        recording = str(r.get("recordingNumber", "")).strip()
        if recording:
            key = (source, recording, lot)
        else:
            key = (source, f"page:{int(r.get('page', 0) or 0)}", lot)
        grouped.setdefault(key, []).append(r)

    out: list[dict[str, Any]] = []
    for group in grouped.values():
        best = sorted(group, key=score, reverse=True)[0]
        out.append(best)

    out.sort(
        key=lambda r: (
            str(r.get("source", "")),
            int(r.get("page", 0) or 0),
            int(r.get("lot", 0) or 0),
            str(r.get("recordingNumber", "")),
        )
    )
    return out


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    data_dir = root / "data"
    working_dir = root / "working"
    working_dir.mkdir(exist_ok=True)

    backup_path = working_dir / "all_deeds_final.original.json"
    existing_path = backup_path if backup_path.exists() else root / "all_deeds_final.json"
    existing = json.loads(existing_path.read_text(encoding="utf-8"))

    page_maps: dict[str, dict[int, str]] = {}
    for source_name, filename in SOURCE_FILES.items():
        page_maps[source_name] = parse_pages(data_dir / filename)

    existing_expanded = parse_existing_deeds_with_related_lots(existing, page_maps)

    scanned_records: list[dict[str, Any]] = []
    for source_name, pages in page_maps.items():
        parsed = parse_source_pages(source_name, pages)
        for d in parsed:
            scanned_records.append(
                {
                    "source": d.source,
                    "page": d.page,
                    "lot": str(d.lot),
                    "phase": d.phase,
                    "deedType": d.deed_type,
                    "grantor": d.grantor,
                    "grantee": d.grantee,
                    "date": d.date_raw,
                    "taxParcel": d.tax_parcel,
                    "recordingNumber": d.recording_number,
                    "exciseTax": d.excise_tax,
                    "consideration": d.consideration,
                    "normalizedDate": d.normalized_date,
                    "isPostAmendment": _is_post_amendment(d.normalized_date),
                    "relatedLots": d.related_lots,
                    "derivedFrom": d.derived_from,
                }
            )

    combined = dedupe_deeds(existing_expanded + scanned_records)

    if not backup_path.exists():
        backup_path.write_text((root / "all_deeds_final.json").read_text(encoding="utf-8"), encoding="utf-8")

    improved_all_path = root / "all_deeds_final.json"
    improved_working_path = working_dir / "deeds_source_truth.json"
    improved_updated_path = working_dir / "deeds_updated.json"

    text = json.dumps(combined, indent=2)
    improved_all_path.write_text(text, encoding="utf-8")
    improved_working_path.write_text(text, encoding="utf-8")
    improved_updated_path.write_text(text, encoding="utf-8")

    summary = {
        "inputExistingCount": len(existing),
        "expandedExistingCount": len(existing_expanded),
        "scannedCount": len(scanned_records),
        "finalCount": len(combined),
        "backupPath": str(backup_path),
        "outputAllDeedsFinal": str(improved_all_path),
        "outputSourceTruth": str(improved_working_path),
    }
    summary_path = working_dir / "deeds_rebuild_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(f"Backed up original deeds to: {backup_path}")
    print(f"Rebuilt deeds count: {len(combined)}")
    print(f"Wrote: {improved_all_path}")
    print(f"Wrote: {improved_working_path}")
    print(f"Wrote summary: {summary_path}")


if __name__ == "__main__":
    main()
