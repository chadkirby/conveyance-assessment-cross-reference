import { readFileSync } from 'node:fs';

const base = '/Users/ckirby/Documents/HOA/Cowork Projects/Conveyance Assessment Cross-Reference';
const deeds = JSON.parse(readFileSync(`${base}/all_deeds_final.json`, 'utf-8'));
const gl = JSON.parse(readFileSync(`${base}/gl_complete.json`, 'utf-8'));

console.log("=== DEEDS WITH MISSING DATES ===");
const missing = deeds.filter((x: any) => !x.normalizedDate);
for (const m of missing) {
  console.log(`Lot ${m.lot} (${m.phase}) | page ${m.page} | src: ${m.source} | parcel: ${m.taxParcel} | date: '${m.date}' | grantor: ${(m.grantor || '').substring(0, 40)}`);
}
console.log(`\nTotal missing: ${missing.length}`);

console.log("\n=== POST-AMENDMENT DEEDS ===");
const post = deeds.filter((x: any) => x.isPostAmendment);
console.log(`Total post-amendment: ${post.length}`);
for (const p of post) {
  console.log(`Lot ${p.lot} | ${p.normalizedDate || 'NO DATE'} | ${(p.grantor || '').substring(0, 35)} -> ${(p.grantee || '').substring(0, 35)} | ${p.deedType}`);
}

console.log("\n=== GL COLLECTIONS ===");
const collections = gl.filter((x: any) => x.type === 'collection');
const withUnit = collections.filter((x: any) => x.unit !== null);
const noUnit = collections.filter((x: any) => x.unit === null);
console.log(`Total collections: ${collections.length}`);
console.log(`With unit: ${withUnit.length}`);
console.log(`Without unit: ${noUnit.length}`);
console.log("\nCollections without unit:");
for (const c of noUnit) {
  console.log(`  ${c.date} | ${c.description} | $${c.amount}`);
}

console.log("\n=== TAX PARCEL -> LOT MAPPING ===");
for (const d of deeds.slice(0, 20)) {
  const parcel = (d.taxParcel || '').replace(/-/g, '');
  const lotFromParcel = parcel.length >= 10 ? parseInt(parcel.substring(4, 9)) / 100 : '???';
  console.log(`Lot ${d.lot} | parcel: ${d.taxParcel} | decoded lot: ${lotFromParcel}`);
}
