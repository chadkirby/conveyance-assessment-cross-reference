import { readFileSync, writeFileSync } from 'node:fs';

const base = '/Users/ckirby/Documents/HOA/Cowork Projects/Conveyance Assessment Cross-Reference';
const deeds: any[] = JSON.parse(readFileSync(`${base}/all_deeds_final.json`, 'utf-8'));

const sourceFiles: Record<string, string> = {
  '4414 Deeds': `${base}/data/Deschutes Heights 4414 Deeds.md`,
  'Phase 1 File': `${base}/data/Deschutes Heights Phase 1 Deeds.md`,
  'Phase 2 File': `${base}/data/Deschutes Heights Phase 2 Deeds.md`,
};

function parsePages(filePath: string): Map<number, string> {
  const content = readFileSync(filePath, 'utf-8');
  const pages = new Map<number, string>();
  const pageRegex = /<!-- PAGE (\d+) -->/g;
  const markers: { page: number; index: number }[] = [];
  let match;
  while ((match = pageRegex.exec(content)) !== null) {
    markers.push({ page: parseInt(match[1]), index: match.index });
  }
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].index;
    const end = i + 1 < markers.length ? markers[i + 1].index : content.length;
    pages.set(markers[i].page, content.substring(start, end));
  }
  return pages;
}

const monthNames: Record<string, number> = {
  'jan': 1, 'january': 1, 'feb': 2, 'february': 2, 'mar': 3, 'march': 3,
  'apr': 4, 'april': 4, 'may': 5, 'jun': 6, 'june': 6,
  'jul': 7, 'july': 7, 'aug': 8, 'august': 8, 'sep': 9, 'september': 9,
  'oct': 10, 'october': 10, 'nov': 11, 'november': 11, 'dec': 12, 'december': 12,
};

function normalizeYear(y: string): number {
  const n = parseInt(y);
  if (n < 100) return n < 50 ? 2000 + n : 1900 + n;
  return n;
}

function formatDate(m: number, d: number, y: number): string {
  return `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y}`;
}

// Extract date from a SINGLE page of text, using strategies ordered by reliability
// Returns { date, strategy } or null
function extractDateFromPage(text: string): { date: string; strategy: string } | null {
  let m;

  // Strategy 1: "Dated: MM/DD/YYYY" or "Dated: M/D/YY" — word boundary before Dated
  m = text.match(/\bDated[:\s]+(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/i);
  if (m) {
    // Reject if preceded by "Up" (i.e., "Updated:")
    const idx = text.indexOf(m[0]);
    if (idx >= 2 && text.substring(idx - 2, idx).toLowerCase() === 'up') {
      // Skip - this is "Updated:", not "Dated:"
    } else {
      return { date: formatDate(parseInt(m[1]), parseInt(m[2]), normalizeYear(m[3])), strategy: 'dated_numeric' };
    }
  }

  // Strategy 2: "Dated: Month DD, YYYY"
  m = text.match(/\bDated[:\s]+([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/i);
  if (m && monthNames[m[1].toLowerCase()]) {
    const idx = text.indexOf(m[0]);
    if (!(idx >= 2 && text.substring(idx - 2, idx).toLowerCase() === 'up')) {
      return { date: formatDate(monthNames[m[1].toLowerCase()], parseInt(m[2]), parseInt(m[3])), strategy: 'dated_month_name' };
    }
  }

  // Strategy 3: "Dated this DDth day of MONTH, YYYY"
  m = text.match(/\bDated\s+this\s+(\d{1,2})(?:st|nd|rd|th)?\s+day\s+of\s+([A-Za-z]+),?\s+(\d{4})/i);
  if (m && monthNames[m[2].toLowerCase()]) {
    return { date: formatDate(monthNames[m[2].toLowerCase()], parseInt(m[1]), parseInt(m[3])), strategy: 'dated_this_day' };
  }

  // Strategy 4: "Dated: M.D.YY" (dot-separated) — but NOT "Updated:"
  m = text.match(/\bDated[:\s]+(\d{1,2})\.(\d{1,2})\.(\d{2,4})/i);
  if (m) {
    const idx = text.indexOf(m[0]);
    if (!(idx >= 2 && text.substring(idx - 2, idx).toLowerCase() === 'up')) {
      return { date: formatDate(parseInt(m[1]), parseInt(m[2]), normalizeYear(m[3])), strategy: 'dated_dots' };
    }
  }

  // Strategy 5: "acknowledged before me on [date]"
  m = text.match(/acknowledged\s+before\s+me\s+on\s+\*?\*?([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\*?\*?/i);
  if (m && monthNames[m[1].toLowerCase()]) {
    return { date: formatDate(monthNames[m[1].toLowerCase()], parseInt(m[2]), parseInt(m[3])), strategy: 'acknowledged' };
  }

  // Also try: "acknowledged before me on **MM-DD-YY**"
  m = text.match(/acknowledged\s+before\s+me\s+on\s+\*?\*?(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\*?\*?/i);
  if (m) {
    return { date: formatDate(parseInt(m[1]), parseInt(m[2]), normalizeYear(m[3])), strategy: 'acknowledged_numeric' };
  }

  return null;
}

// Extract recording header stamp (lower priority)
function extractRecordingStamp(text: string): { date: string; strategy: string } | null {
  const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+\d{1,2}:\d{2}\s*(?:AM|PM)/i);
  if (m) {
    return { date: formatDate(parseInt(m[1]), parseInt(m[2]), parseInt(m[3])), strategy: 'recording_stamp' };
  }

  // Old-style: "DD MON 'YY" or "MON DD'YY"
  let m2 = text.match(/(\d{1,2})\s+([A-Za-z]{3})\s+'(\d{2})/);
  if (m2 && monthNames[m2[2].toLowerCase()]) {
    return { date: formatDate(monthNames[m2[2].toLowerCase()], parseInt(m2[1]), normalizeYear(m2[3])), strategy: 'old_stamp' };
  }
  m2 = text.match(/([A-Za-z]{3})\s+(\d{1,2})\s*'(\d{2})/);
  if (m2 && monthNames[m2[1].toLowerCase()]) {
    return { date: formatDate(monthNames[m2[1].toLowerCase()], parseInt(m2[2]), normalizeYear(m2[3])), strategy: 'old_stamp' };
  }

  return null;
}

const pageMaps: Record<string, Map<number, string>> = {};
for (const [src, path] of Object.entries(sourceFiles)) {
  pageMaps[src] = parsePages(path);
}

const missing = deeds.filter((d: any) => !d.normalizedDate);
console.log(`=== RECOVERING DATES FOR ${missing.length} DEEDS ===\n`);

let recovered = 0;
for (const deed of missing) {
  const pageMap = pageMaps[deed.source];
  if (!pageMap) {
    console.log(`[SKIP] Lot ${deed.lot} - unknown source: ${deed.source}`);
    continue;
  }

  const pageNum = deed.page;
  let foundDate: string | null = null;
  let foundStrategy = '';

  // First pass: look for "Dated:" or "acknowledged" on primary page and continuations
  for (let p = pageNum; p <= pageNum + 3; p++) {
    const pageText = pageMap.get(p);
    if (!pageText) continue;

    // If this is a continuation page, check it belongs to the same deed
    if (p > pageNum) {
      // Check for "Page X of Y" at the top referencing the same recording number
      // Or check if there's a new "When recorded return to:" which starts a new deed
      const hasNewDeedStart = pageText.match(/When recorded return to:/i);
      const hasContinuation = pageText.match(/Page\s+\d+\s+of\s+\d+/i) || pageText.match(/\(continued\)/i);

      if (hasNewDeedStart && !hasContinuation) break;
    }

    const result = extractDateFromPage(pageText);
    if (result) {
      foundDate = result.date;
      foundStrategy = `${result.strategy} (page ${p})`;
      break;
    }
  }

  // Second pass: if no "Dated:" found, use recording header stamp
  if (!foundDate) {
    for (let p = pageNum; p <= pageNum + 1; p++) {
      const pageText = pageMap.get(p);
      if (!pageText) continue;
      const result = extractRecordingStamp(pageText);
      if (result) {
        foundDate = result.date;
        foundStrategy = `${result.strategy} (page ${p})`;
        break;
      }
    }
  }

  if (foundDate) {
    deed.normalizedDate = foundDate;
    deed.dateSource = foundStrategy;
    const [mm, dd, yyyy] = foundDate.split('/').map(Number);
    const dateObj = new Date(yyyy, mm - 1, dd);
    const amendmentDate = new Date(2021, 0, 11);
    deed.isPostAmendment = dateObj >= amendmentDate;
    recovered++;
    console.log(`[OK] Lot ${deed.lot} (${deed.phase}) | ${foundDate} | strategy: ${foundStrategy} | post-amendment: ${deed.isPostAmendment}`);
  } else {
    console.log(`[FAIL] Lot ${deed.lot} (${deed.phase}) | page ${pageNum} | src: ${deed.source}`);
    const dbgText = (pageMap.get(pageNum) || '').substring(0, 300);
    console.log(`  Preview: ${dbgText.replace(/\n/g, ' | ')}`);
  }
}

console.log(`\nRecovered ${recovered} of ${missing.length} missing dates`);

// Write updated deeds
writeFileSync('//Users/ckirby/Documents/HOA/Cowork Projects/Conveyance Assessment Cross-Reference/working/deeds_updated.json', JSON.stringify(deeds, null, 2));

// Also verify all deeds now have dates
const stillMissing = deeds.filter((d: any) => !d.normalizedDate);
if (stillMissing.length > 0) {
  console.log(`\nStill missing (${stillMissing.length}):`);
  for (const d of stillMissing) {
    console.log(`  Lot ${d.lot} (${d.phase}) | page ${d.page} | ${d.source}`);
  }
} else {
  console.log('\nAll deeds now have dates!');
}

// Show post-amendment summary
const postAmendment = deeds.filter((d: any) => d.isPostAmendment);
console.log(`\nTotal post-amendment deeds: ${postAmendment.length}`);
