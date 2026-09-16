export const LOOP_MODES = ["none", "queue", "media"];

export function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

export function getPlaybackProgress(position, duration) {
  const elapsed = Number(position);
  const total = Number(duration);
  if (!Number.isFinite(elapsed) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(Math.max(elapsed / total, 0), 1);
}

export function getMediaKind(mime = "") {
  const value = typeof mime === "string" ? mime : "";
  if (value.startsWith("audio/")) return "audio";
  if (value.startsWith("video/")) return "video";
  if (value.startsWith("image/")) return "image";
  return "file";
}

export function getMediaLabel(mime = "") {
  const kind = getMediaKind(mime);
  if (kind === "audio") return "Audio";
  if (kind === "video") return "Video";
  if (kind === "image") return "Photo";
  return "File";
}

export function getArtistLabel(artists, fallback = "Unknown artist") {
  if (Array.isArray(artists)) {
    const label = artists.filter(Boolean).map((item) => String(item).trim()).filter(Boolean).join(", ");
    if (label && label.toLowerCase() !== "unknown" && label.toLowerCase() !== "unknown artist") {
      return label;
    }
  }
  if (typeof artists === "string" && artists.trim()) {
    const trimmed = artists.trim();
    if (trimmed.toLowerCase() !== "unknown" && trimmed.toLowerCase() !== "unknown artist") {
      return trimmed;
    }
  }
  return fallback;
}

const GENERIC_CATEGORY_NAMES = new Set([
  "music",
  "audio",
  "songs",
  "soundtrack",
  "library",
  "lagu",
  "video",
  "film",
  "movie",
  "movies",
  "photos",
  "photo",
  "images",
]);

export function parseArtistFromTitle(title) {
  if (typeof title !== "string" || !title.trim()) return null;
  // Strip leading track numbers: "01. ", "01 - ", "01 ", "1. "
  const cleaned = title.replace(/^\s*\d+[\s.)-]+\s*/, "").trim();
  const match = cleaned.match(/^(.+?)\s*(?:[-–—]|:)\s+(.+)$/);
  if (match) {
    const candidate = match[1].trim();
    if (candidate && candidate.toLowerCase() !== "unknown" && candidate.toLowerCase() !== "unknown artist") {
      return candidate;
    }
  }
  return null;
}

export function parseArtistFromCategory(categoryPath, categoryName) {
  if (typeof categoryPath === "string" && categoryPath.trim()) {
    const parts = categoryPath
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length >= 3) {
      if (GENERIC_CATEGORY_NAMES.has(parts[0].toLowerCase())) {
        return parts[1];
      }
      return parts[0];
    }

    if (parts.length === 2) {
      if (GENERIC_CATEGORY_NAMES.has(parts[0].toLowerCase())) {
        return parts[1];
      }
      return parts[0];
    }

    if (parts.length === 1 && !GENERIC_CATEGORY_NAMES.has(parts[0].toLowerCase())) {
      return parts[0];
    }
  }

  if (typeof categoryName === "string" && categoryName.trim()) {
    const trimmed = categoryName.trim();
    if (!GENERIC_CATEGORY_NAMES.has(trimmed.toLowerCase())) {
      return trimmed;
    }
  }

  return null;
}

export function resolveMediaArtist(media, fallback = "Unknown artist") {
  if (!media) return fallback;

  const kind = getMediaKind(media.mime_type);
  if (kind !== "audio") {
    return media.category_path || media.category_name || getMediaLabel(media.mime_type);
  }

  // 1. Direct artists / artist field
  const directArtist = getArtistLabel(media.artists || media.artist, null);
  if (directArtist) return directArtist;

  // 2. Album artist if provided
  const albumArtist = getArtistLabel(media.album_artist || media.albumArtist, null);
  if (albumArtist) return albumArtist;

  // 3. Artist parsed from title ("Artist - Track")
  const titleArtist = parseArtistFromTitle(media.title);
  if (titleArtist) return titleArtist;

  // 4. Artist resolved from category hierarchy ("Music / Muse / Absolution" -> "Muse")
  const categoryArtist = parseArtistFromCategory(media.category_path, media.category_name);
  if (categoryArtist) return categoryArtist;

  // 5. Category or folder name if available and not generic
  const folderName = getMediaFolderName(media);
  if (folderName && folderName !== "Library" && !GENERIC_CATEGORY_NAMES.has(folderName.toLowerCase())) {
    return folderName;
  }

  return fallback;
}

export function getMediaFolderName(media) {
  return media?.category_path || media?.category_name || "Library";
}

export function nextLoopMode(mode) {
  const index = LOOP_MODES.indexOf(mode);
  return LOOP_MODES[(index + 1) % LOOP_MODES.length];
}
