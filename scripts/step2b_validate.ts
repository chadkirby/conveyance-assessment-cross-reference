import { readFileSync } from 'fs';

const base = '/Users/ckirby/Documents/HOA/Cowork Projects/Conveyance Assessment Cross-Reference';

// Check the JK Monarch deeds - are they the sale to homeowners or the bulk transfer?
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

const deeds: any[] = JSON.parse(readFileSync('//Users/ckirby/Documents/HOA/Cowork Projects/Conveyance Assessment Cross-Reference/working/deeds_updated.json', 'utf-8'));

// Check JK Monarch deeds that all got 03/07/2022
const jkLots = [50, 51, 52, 53, 54, 55, 57, 58, 60];
for (const lot of jkLots) {
  const deed = deeds.find((d: any) => d.lot === String(lot) && d.grantor?.includes('JK Monarch'));
  if (!deed) continue;

  const pages = parsePages(sourceFiles[deed.source]);
  console.log(`\n=== LOT ${lot} (page ${deed.page}, src: ${deed.source}) ===`);
  console.log(`Grantor: ${deed.grantor}`);
  console.log(`Grantee: ${deed.grantee}`);
  console.log(`Recovered date: ${deed.normalizedDate}`);

  // Show the page content and next 3 pages
  for (let p = deed.page; p <= deed.page + 3; p++) {
    const text = pages.get(p);
    if (!text) continue;
    // Check if this is still the same deed
    if (p > deed.page && text.includes('When recorded return to:') && !text.includes('Page') ) {
      // Might be a new deed
    }
    // Show key lines
    const lines = text.split('\n').filter(l =>
      /dated|acknowledged|parcel|lot \d|page \d+ of|monarch|recording|^\d{7}/i.test(l)
    );
    if (lines.length > 0) {
      console.log(`  --- Page ${p} key lines ---`);
      for (const l of lines) console.log(`    ${l.trim()}`);
    }
  }
}

// Also check lot 50 specifically from the 4414 Deeds file which I already confirmed earlier
console.log('\n\n=== VERIFYING LOT 50 (4414 Deeds, page 102) ===');
const p1 = parsePages(sourceFiles['4414 Deeds']);
for (let p = 102; p <= 105; p++) {
  const text = p1.get(p);
  if (text) {
    console.log(`\n--- PAGE ${p} (first 600 chars) ---`);
    console.log(text.substring(0, 600));
  }
}

// Also check lot 55 (Phase 1, page 121) - supposed to be JK Monarch → Linda Stamer
console.log('\n\n=== VERIFYING LOT 55 (Phase 1, page 121) ===');
const p2 = parsePages(sourceFiles['Phase 1 File']);
for (let p = 121; p <= 124; p++) {
  const text = p2.get(p);
  if (text) {
    console.log(`\n--- PAGE ${p} (first 600 chars) ---`);
    console.log(text.substring(0, 600));
  }
}
