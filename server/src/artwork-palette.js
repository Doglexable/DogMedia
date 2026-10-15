import { execFile } from "child_process";
import { stat } from "fs/promises";
import { promisify } from "util";
import { resolve, sep } from "path";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(new URL("../scripts/check-color.py", import.meta.url));
export const ARTWORK_PALETTE_VERSION = 1;

export function artworkFilePath(dataDir, artworkPath) {
  if (typeof artworkPath !== "string" || !artworkPath || artworkPath.includes("\0")) {
    throw new Error("Invalid artwork path");
  }
  const root = resolve(dataDir);
  const filePath = resolve(root, artworkPath);
  if (!filePath.startsWith(`${root}${sep}`)) throw new Error("Artwork path escapes the media directory");
  return filePath;
}

function validColors(colors) {
  return Array.isArray(colors) && colors.length > 0 && colors.length <= 10
    && colors.every((color) => /^#[0-9a-f]{6}$/i.test(color?.hex)
      && Number.isFinite(color?.percentage)
      && color.percentage >= 0 && color.percentage <= 100);
}

export function sharePaletteAccent(colors) {
  if (!validColors(colors)) return null;
  const colorful = colors.find(({ hex, percentage }) => {
    const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
    return percentage >= 5 && Math.max(...channels) - Math.min(...channels) >= 32;
  });
  return (colorful || colors[0]).hex.toLowerCase();
}

export async function ensureArtworkPalette({ pg, dataDir, artworkPath, runScript = execFileAsync }) {
  if (!artworkPath) return null;
  const filePath = artworkFilePath(dataDir, artworkPath);
  const fileStat = await stat(filePath);
  const fileFingerprint = `${fileStat.size}:${Math.trunc(fileStat.mtimeMs)}`;
  const { rows } = await pg.query(
    "SELECT colors, algorithm_version, file_fingerprint FROM artwork_palettes WHERE artwork_path = $1",
    [artworkPath]
  );
  if (Number(rows[0]?.algorithm_version) === ARTWORK_PALETTE_VERSION
    && rows[0].file_fingerprint === fileFingerprint && validColors(rows[0].colors)) {
    return rows[0].colors;
  }

  const { stdout } = await runScript(
    process.env.PFS_COLOR_PYTHON || "python",
    [SCRIPT_PATH, filePath, "--json"],
    { timeout: 30_000, maxBuffer: 64 * 1024 }
  );
  const result = JSON.parse(stdout);
  if (result.algorithm_version !== ARTWORK_PALETTE_VERSION || !validColors(result.colors)) {
    throw new Error("Artwork palette script returned invalid colors");
  }
  await pg.query(
    `INSERT INTO artwork_palettes (artwork_path, colors, algorithm_version, file_fingerprint)
     VALUES ($1, $2::jsonb, $3, $4)
     ON CONFLICT (artwork_path) DO UPDATE
       SET colors = EXCLUDED.colors,
           algorithm_version = EXCLUDED.algorithm_version,
           file_fingerprint = EXCLUDED.file_fingerprint,
           computed_at = NOW()`,
    [artworkPath, JSON.stringify(result.colors), ARTWORK_PALETTE_VERSION, fileFingerprint]
  );
  return result.colors;
}
