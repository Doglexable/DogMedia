import { faFile, faImage, faMusic, faVideo } from "@fortawesome/free-solid-svg-icons";

export const LOOP_MODES = ["none", "queue", "media"];

export function formatDuration(seconds) {
  if (!seconds) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds) % 60).padStart(2, "0")}`;
}

export function getMediaMeta(mime = "") {
  const safeMime = typeof mime === "string" ? mime : "";
  if (safeMime.startsWith("video/")) return { icon: faVideo, label: "Video" };
  if (safeMime.startsWith("audio/")) return { icon: faMusic, label: "Audio" };
  if (safeMime.startsWith("image/")) return { icon: faImage, label: "Photo" };
  return { icon: faFile, label: "File" };
}

export function getMediaFolder(media) {
  if (media?.category_path) return media.category_path;
  if (media?.category_name) return media.category_name;
  if (media?.file_path?.includes("/")) return media.file_path.split("/").slice(0, -1).join("/");
  return "Library";
}

export function getMediaFolderName(media) {
  const folder = getMediaFolder(media);
  const parts = folder.split("/").map((part) => part.trim()).filter(Boolean);
  return parts.at(-1) || folder;
}

export function getCategoryQuery(categoryId) {
  return categoryId ? `?category=${categoryId}` : "";
}

export function getAutoQueueEndpoint(mediaId, categoryId = null, context = null) {
  if (context === "liked" || categoryId === "liked") {
    return `/api/queue/auto/likes?start=${mediaId}&compact=1`;
  }
  if (categoryId) {
    return `/api/queue/auto/${categoryId}?start=${mediaId}&compact=1`;
  }
  return `/api/queue/auto?start=${mediaId}&compact=1`;
}

export function getNextLoopMode(mode) {
  const index = LOOP_MODES.indexOf(mode);
  return LOOP_MODES[(index + 1) % LOOP_MODES.length];
}

export function getLoopButtonTitle(mode) {
  if (mode === "queue") return "Loop queue";
  if (mode === "media") return "Loop media";
  return "No loop";
}

export function getQueueBoundaryParams(atEnd, queueTotal = 0) {
  const offset = atEnd ? String(Math.max(queueTotal - 1, 0)) : "0";
  return new URLSearchParams({ limit: "1", offset });
}

export function getCompletionAction({ hasLinearNext, loopMode, queueLength = 0 }) {
  if (loopMode === "media") return "repeat";
  if (hasLinearNext) return "advance";
  if (loopMode === "queue" && queueLength > 0) return "wrap";
  return "stop";
}

export const PAUSE_CACHE_TTL_MS = 30 * 60 * 1000;

export function isPauseTimeoutExpired(pausedAt, now = Date.now(), timeoutMs = PAUSE_CACHE_TTL_MS) {
  if (!pausedAt) return false;
  const pauseTime = typeof pausedAt === "number" ? pausedAt : new Date(pausedAt).getTime();
  if (!Number.isFinite(pauseTime)) return false;
  return (now - pauseTime) >= timeoutMs;
}

export const GENERIC_CATEGORY_NAMES = new Set([
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

export function parseArtistFromTitle(title) {
  if (typeof title !== "string" || !title.trim()) return null;
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

  const mime = typeof media.mime_type === "string" ? media.mime_type : "";
  const isAudio = !mime || mime.startsWith("audio/");
  if (mime && !isAudio) {
    return media.category_path || media.category_name || getMediaMeta(mime).label;
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
  const folder = media.category_path || media.category_name;
  if (folder && folder !== "Library" && !GENERIC_CATEGORY_NAMES.has(folder.toLowerCase())) {
    return folder;
  }

  return fallback;
}


