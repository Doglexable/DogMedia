import { faFile } from "@fortawesome/free-solid-svg-icons/faFile";
import { faImage } from "@fortawesome/free-solid-svg-icons/faImage";
import { faMusic } from "@fortawesome/free-solid-svg-icons/faMusic";
import { faVideo } from "@fortawesome/free-solid-svg-icons/faVideo";

export const LOOP_MODES = ["none", "queue", "media"];

export function formatDuration(seconds) {
  const totalSeconds = Math.floor(Number(seconds));
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "0:00";

  const remainingSeconds = String(totalSeconds % 60).padStart(2, "0");
  if (totalSeconds < 3600) {
    return `${Math.floor(totalSeconds / 60)}:${remainingSeconds}`;
  }

  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  return `${hours}:${minutes}:${remainingSeconds}`;
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

export function getPlaylistSuggestionRoute(suggestion, isFullPlayer) {
  if (!isFullPlayer) return null;
  const mediaId = Number(suggestion?.media?.id);
  const categoryId = Number(suggestion?.category?.id);
  if (!Number.isFinite(mediaId) || !Number.isFinite(categoryId)) return null;
  return `/media/${mediaId}${getCategoryQuery(categoryId)}`;
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

export function shouldCompleteSleepTimer(mode, hasLinearNext) {
  return mode === "media" || (mode === "playlist" && !hasLinearNext);
}

export function shouldSuggestSiblingMedia(sleepTimerMode, sleepTimerCompleted) {
  return !sleepTimerMode && !sleepTimerCompleted;
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

export function isSpaceKey(event) {
  if (!event) return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return event.key === " " || event.key === "Spacebar" || event.code === "Space";
}

export function isEditableTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName?.toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (tag === "input") {
    const type = target.type?.toLowerCase();
    return type !== "range";
  }
  return false;
}

export function isPlayPauseElement(target) {
  if (!target) return false;
  const el = target.closest?.("button, [role='button']") || target;
  const shortcuts = el.getAttribute?.("aria-keyshortcuts");
  if (shortcuts && shortcuts.toLowerCase().includes("space")) return true;
  const label = el.getAttribute?.("aria-label")?.toLowerCase();
  if (label === "play" || label === "pause") return true;
  const className = typeof el.className === "string" ? el.className : "";
  if (
    className.includes("player-play-button") ||
    className.includes("fullscreen-player-play") ||
    className.includes("video-player-ctrl-btn--primary")
  ) {
    return true;
  }
  return false;
}

export function shouldHandleSpaceKey(event) {
  if (!isSpaceKey(event)) return false;
  if (event.defaultPrevented) return false;
  const target = event.target;
  if (isEditableTarget(target)) return false;

  if (target) {
    const button = target.closest?.("button, [role='button']");
    if (button && !isPlayPauseElement(button)) {
      try {
        if (typeof button.matches === "function" && button.matches(":focus-visible")) {
          return false;
        }
      } catch {
        // Ignore selector errors in unsupported test environments
      }
    }
  }

  return true;
}
