import { access, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import pg from "pg";
import { blurPathFromCover, generateBlurCover } from "./category-cover.js";

const dryRun = process.argv.includes("--dry-run");
const defaultDataDir = existsSync("data/media") ? "data/media" : "data";
const dataDir = process.env.DATA_DIR || defaultDataDir;
const databaseUrl = process.env.DATABASE_URL || "postgres://pfs:pfs_secret@localhost:5440/pfs";

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findWebpFiles(dir) {
  const results = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await findWebpFiles(fullPath)));
      } else if (entry.isFile() && entry.name.endsWith(".webp") && !entry.name.endsWith("-blur.webp")) {
        results.push(fullPath);
      }
    }
  } catch {
    // Directory unreadable or not found
  }
  return results;
}

export async function runBackfillBlur({ dataDir: targetDir = dataDir, dbUrl = databaseUrl, isDryRun = dryRun } = {}) {
  const stats = {
    discovered: 0,
    alreadyPresent: 0,
    generated: 0,
    errors: 0,
    details: [],
  };

  const candidatePaths = new Set();

  // 1. Check database if accessible
  const client = new pg.Client({ connectionString: dbUrl });
  let dbConnected = false;
  try {
    await client.connect();
    dbConnected = true;

    const { rows: categoryRows } = await client.query(
      "SELECT DISTINCT cover_path FROM categories WHERE cover_path IS NOT NULL"
    );
    for (const row of categoryRows) {
      if (row.cover_path) candidatePaths.add(join(targetDir, row.cover_path));
    }

    const { rows: mediaRows } = await client.query(
      "SELECT DISTINCT thumbnail_path FROM media_assets WHERE thumbnail_path IS NOT NULL"
    );
    for (const row of mediaRows) {
      if (row.thumbnail_path) candidatePaths.add(join(targetDir, row.thumbnail_path));
    }
  } catch {
    // Standalone / offline backfill fallback
  } finally {
    if (dbConnected) await client.end().catch(() => {});
  }

  // 2. Also scan data directory for any artwork/thumbnail webp files
  const discoveredOnDisk = await findWebpFiles(targetDir);
  for (const diskPath of discoveredOnDisk) {
    candidatePaths.add(diskPath);
  }

  stats.discovered = candidatePaths.size;

  for (const inputPath of candidatePaths) {
    if (!(await fileExists(inputPath))) continue;

    const blurPath = blurPathFromCover(inputPath);
    if (!blurPath || blurPath === inputPath) continue;

    if (await fileExists(blurPath)) {
      stats.alreadyPresent += 1;
      continue;
    }

    if (isDryRun) {
      stats.generated += 1;
      stats.details.push({ inputPath, blurPath, status: "dry-run" });
      continue;
    }

    try {
      const generatedStat = await generateBlurCover({ inputPath, outputPath: blurPath });
      stats.generated += 1;
      stats.details.push({ inputPath, blurPath, bytes: generatedStat.size, status: "generated" });
    } catch (error) {
      stats.errors += 1;
      stats.details.push({ inputPath, blurPath, error: error.message, status: "error" });
    }
  }

  return stats;
}

if (process.argv[1] && process.argv[1].endsWith("backfill-blur-covers.js")) {
  console.log(`Starting blur cover backfill... (dataDir: ${dataDir}, dryRun: ${dryRun})`);
  const results = await runBackfillBlur();
  console.log(JSON.stringify(results, null, 2));
}
