const AUDIO_IMPORT_PRIORITY = ["flac", "wav", "m4a", "mp3", "ogg", "opus", "aac"];
const VIDEO_IMPORT_EXTENSIONS = new Set(["mp4", "mkv", "webm", "mov", "avi"]);
const COVER_BASENAMES = new Set(["cover", "front-cover", "front_cover", "front", "folder", "albumart", "album-art"]);

export function getExt(fileName) {
  const parts = String(fileName || "").split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

function getStem(fileName) {
  const name = String(fileName || "").split("/").pop();
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function getRelativeDir(file) {
  const relativePath = file.webkitRelativePath || file.name;
  const lastSlash = relativePath.lastIndexOf("/");
  return lastSlash > -1 ? relativePath.slice(0, lastSlash) : "";
}

export function titleFromStem(stem) {
  return stem
    .replace(/^[\d\s._-]+/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || stem;
}

export function trackOrderFromStem(stem) {
  const match = String(stem || "").trim().match(/^(\d{1,3})(?:\s*[._-]|\s+)/);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isInteger(value) && value >= 1 ? value : null;
}

export function videoOrderFromStem(stem) {
  const episodeMatch = String(stem || "").match(/(?:S\d{1,2}\s*)?E(?:P(?:ISODE)?)?\s*(\d{1,3})/i)
    || String(stem || "").match(/(?:EP(?:ISODE)?|PART)\s*[._-]?\s*(\d{1,3})/i);
  if (episodeMatch) return Number.parseInt(episodeMatch[1], 10);
  return trackOrderFromStem(stem);
}

export function buildVideoItems(files) {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return files
    .filter((file) => file.type.startsWith("video/") || VIDEO_IMPORT_EXTENSIONS.has(getExt(file.name)))
    .sort((a, b) => collator.compare(a.name, b.name))
    .map((file, index) => {
      const stem = getStem(file.name);
      return {
        key: `${file.name}:${file.size}:${file.lastModified || index}`,
        file,
        title: titleFromStem(stem),
        trackOrder: videoOrderFromStem(stem) || index + 1,
      };
    })
    .sort((a, b) => a.trackOrder - b.trackOrder || collator.compare(a.file.name, b.file.name));
}

export function estimateUploadRemaining({ elapsedMs, totalBytes, uploadedBytes }) {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0
    || !Number.isFinite(uploadedBytes) || uploadedBytes <= 0
    || !Number.isFinite(totalBytes) || totalBytes <= uploadedBytes) {
    return totalBytes <= uploadedBytes && uploadedBytes > 0
      ? { bytesPerSecond: uploadedBytes / Math.max(elapsedMs / 1000, 0.001), remainingSeconds: 0 }
      : null;
  }
  const bytesPerSecond = uploadedBytes / (elapsedMs / 1000);
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return null;
  return {
    bytesPerSecond,
    remainingSeconds: Math.max(0, Math.ceil((totalBytes - uploadedBytes) / bytesPerSecond)),
  };
}

export function formatUploadRemaining(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "Estimating time remaining…";
  if (seconds === 0) return "Processing upload…";
  if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))}s remaining`;
  if (seconds < 60 * 60) return `${Math.ceil(seconds / 60)}m remaining`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  return `${hours}h${minutes ? ` ${minutes}m` : ""} remaining`;
}

export function summarizeEncodingStatus(status) {
  if (!status || typeof status !== "object" || Object.keys(status).length === 0) return null;
  const qualities = ["low", "med", "high"].map((quality) => {
    const item = status[quality] || { status: "queued", progress: 0 };
    const progress = ["ready", "skipped"].includes(item.status)
      ? 100
      : Math.max(0, Math.min(100, Number(item.progress) || 0));
    return { quality, ...item, progress };
  });
  const percent = Math.round(qualities.reduce((total, item) => total + item.progress, 0) / qualities.length);
  const processing = qualities.find((item) => item.status === "processing");
  const failed = qualities.filter((item) => item.status === "failed").length;
  const pending = qualities.filter((item) => ["queued", "processing"].includes(item.status)).length;
  const label = processing
    ? `Encoding ${processing.quality.toUpperCase()} at ${processing.progress}%`
    : failed
      ? `${failed} resolution${failed === 1 ? "" : "s"} failed`
      : pending
        ? "Waiting for encoding worker"
        : "All resolutions ready";
  return { failed, label, pending, percent, qualities };
}

function isAudioImportFile(file) {
  return file.type.startsWith("audio/") || AUDIO_IMPORT_PRIORITY.includes(getExt(file.name));
}

function isCoverFile(file) {
  return file.type.startsWith("image/") && COVER_BASENAMES.has(getStem(file.name).toLowerCase());
}

export function buildBatchItems(files) {
  const folders = new Map();

  for (const file of files) {
    const folderName = getRelativeDir(file);
    if (!folders.has(folderName)) folders.set(folderName, { cover: null, lyrics: new Map(), tracks: new Map() });
    const folder = folders.get(folderName);
    if (isCoverFile(file)) {
      folder.cover = folder.cover || file;
      continue;
    }
    if (getExt(file.name) === "json") {
      folder.lyrics.set(getStem(file.name), file);
      continue;
    }
    if (!isAudioImportFile(file)) continue;
    const stem = getStem(file.name);
    if (!folder.tracks.has(stem)) folder.tracks.set(stem, []);
    folder.tracks.get(stem).push(file);
  }

  const items = [];
  for (const [folderName, folder] of folders) {
    for (const [stem, candidates] of folder.tracks) {
      const sorted = [...candidates].sort((a, b) => {
        const aRank = AUDIO_IMPORT_PRIORITY.indexOf(getExt(a.name));
        const bRank = AUDIO_IMPORT_PRIORITY.indexOf(getExt(b.name));
        return (aRank === -1 ? 999 : aRank) - (bRank === -1 ? 999 : bRank);
      });
      const file = sorted[0];
      items.push({
        key: `${folderName}/${stem}`,
        title: titleFromStem(stem),
        trackOrder: trackOrderFromStem(stem),
        file,
        lyrics: folder.lyrics.get(stem) || null,
        thumbnail: folder.cover,
        folderName,
        skippedCount: Math.max(0, sorted.length - 1),
      });
    }
  }
  return items.sort((a, b) => a.key.localeCompare(b.key));
}
