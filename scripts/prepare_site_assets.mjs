import { mkdir, readdir, rm, stat, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const rootDir = resolve(scriptDir, "..");
const appPublicDir = join(rootDir, "app", "public");
const dataOutDir = join(appPublicDir, "data");
const pdfOutDir = join(appPublicDir, "pdfs");

const requiredFiles = [
  ["chain-of-title.json", join(rootDir, "chain-of-title.json")],
  ["cross_reference_rows.json", join(rootDir, "working", "cross_reference_rows.json")],
  ["conveyance_assessment_data.json", join(rootDir, "working", "conveyance_assessment_data.json")],
  ["analysis_summary.json", join(rootDir, "working", "analysis_summary.json")],
];

async function ensureFile(path) {
  try {
    const fileStat = await stat(path);
    if (!fileStat.isFile()) {
      throw new Error();
    }
  } catch {
    throw new Error(`Missing required pipeline output: ${path}`);
  }
}

async function main() {
  for (const [, sourcePath] of requiredFiles) {
    await ensureFile(sourcePath);
  }

  await rm(dataOutDir, { recursive: true, force: true });
  await rm(pdfOutDir, { recursive: true, force: true });
  await mkdir(dataOutDir, { recursive: true });
  await mkdir(pdfOutDir, { recursive: true });

  for (const [filename, sourcePath] of requiredFiles) {
    await copyFile(sourcePath, join(dataOutDir, filename));
  }

  const pdfSourceDir = join(rootDir, "pdfs");
  const entries = await readdir(pdfSourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".pdf")) {
      continue;
    }
    await copyFile(join(pdfSourceDir, entry.name), join(pdfOutDir, entry.name));
  }

  console.log(`Prepared static data in ${dataOutDir}`);
  console.log(`Copied PDFs into ${pdfOutDir}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
