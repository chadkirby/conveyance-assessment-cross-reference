import { readFileSync, readdirSync, writeFileSync } from 'fs';

const dataDir = '/Users/ckirby/Documents/HOA/Cowork Projects/Conveyance Assessment Cross-Reference/data';

interface ResaleEntry {
  accountNumber: string;
  newOwner: string;
  address: string;
  lot: number;
  previousOwner: string;
  processDate: string;
  escrowDate: string;
  sourceFile: string;
  reportPeriod: string;
}

const files = readdirSync(dataDir).filter(f => f.includes('Homeowner Resale Report.md')).sort();
const allEntries: ResaleEntry[] = [];

for (const file of files) {
  const content = readFileSync(`${dataDir}/${file}`, 'utf-8');

  // Extract report period from "Escrow Date:" line
  const periodMatch = content.match(/Escrow Date[:\s*]*\*?\*?\s*(\d+\/\d+\/\d+)\s*-\s*(\d+\/\d+\/\d+)/);
  const reportPeriod = periodMatch ? `${periodMatch[1]}-${periodMatch[2]}` : '';

  // Extract rows from HTML table - find all <tr> in tbody
  const tbodyMatch = content.match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!tbodyMatch) continue;

  const tbody = tbodyMatch[1];
  if (tbody.includes('No data rows')) continue;

  // Match each <tr>...</tr>
  const rowRegex = /<tr>([\s\S]*?)<\/tr>/g;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(tbody)) !== null) {
    const cells: string[] = [];
    const cellRegex = /<td>([\s\S]*?)<\/td>/g;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      cells.push(cellMatch[1].trim());
    }
    if (cells.length >= 7) {
      const lotStr = cells[3].replace(/^0+/, '') || '0';
      allEntries.push({
        accountNumber: cells[0],
        newOwner: cells[1],
        address: cells[2],
        lot: parseInt(lotStr),
        previousOwner: cells[4],
        processDate: cells[5],
        escrowDate: cells[6],
        sourceFile: file,
        reportPeriod,
      });
    }
  }
}

console.log(`Parsed ${allEntries.length} resale entries from ${files.length} files`);

// Deduplicate: same lot + same new owner = same transfer
const seen = new Set<string>();
const deduped: ResaleEntry[] = [];
for (const e of allEntries) {
  const key = `${e.lot}|${e.newOwner.toLowerCase().trim()}`;
  if (!seen.has(key)) {
    seen.add(key);
    deduped.push(e);
  }
}
console.log(`After dedup: ${deduped.length} unique transfers`);

// Show some stats
const lotsWithAddress = new Map<number, string>();
for (const e of deduped) {
  if (e.address) lotsWithAddress.set(e.lot, e.address);
}
console.log(`Lots with addresses: ${lotsWithAddress.size}`);

// Write output
writeFileSync('//Users/ckirby/Documents/HOA/Cowork Projects/Conveyance Assessment Cross-Reference/working/resale_parsed.json', JSON.stringify(deduped, null, 2));
console.log('Wrote resale_parsed.json');

// Also show entries sorted by lot
deduped.sort((a, b) => a.lot - b.lot || a.escrowDate.localeCompare(b.escrowDate));
for (const e of deduped) {
  console.log(`Lot ${String(e.lot).padStart(3)} | ${e.escrowDate.padEnd(12)} | ${e.newOwner.substring(0, 40).padEnd(42)} | prev: ${e.previousOwner.substring(0, 35)} | ${e.address}`);
}
