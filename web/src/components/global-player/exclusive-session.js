const KNOWN_PLATFORMS = ["web", "desktop", "mobile"];

const PLATFORM_LABELS = {
  web: "Dogmedia Web",
  desktop: "Dogmedia Desktop",
  mobile: "Dogmedia Mobile",
};

function normalizeDeviceLabel(value, platform) {
  const fallback = PLATFORM_LABELS[platform] || "Another device";
  if (typeof value !== "string") return fallback;
  const label = value
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(label).slice(0, 64).join("").trimEnd() || fallback;
}

export function normalizeHolderSession(value) {
  if (!value || typeof value !== "object") return null;
  const platform = KNOWN_PLATFORMS.includes(value.platform) ? value.platform : "unknown";
  const deviceLabel = normalizeDeviceLabel(value.deviceLabel, platform);
  const holder = {
    platform,
    deviceLabel,
  };
  if (Number.isInteger(value.mediaId) && value.mediaId > 0) holder.mediaId = value.mediaId;
  if (value.playback && typeof value.playback === "object") {
    const playbackMediaId = Number.isInteger(value.playback.mediaId) && value.playback.mediaId > 0
      ? value.playback.mediaId
      : holder.mediaId;
    const action = value.playback.action === "play" ? "play" : value.playback.action === "pause" ? "pause" : null;
    if (playbackMediaId && action) {
      holder.playback = {
        mediaId: playbackMediaId,
        action,
        position: Number.isInteger(value.playback.position) && value.playback.position >= 0 ? value.playback.position : 0,
        duration: Number.isInteger(value.playback.duration) && value.playback.duration >= 0 ? value.playback.duration : 0,
        loopMode: ["none", "queue", "media"].includes(value.playback.loopMode) ? value.playback.loopMode : "none",
        shuffleEnabled: Boolean(value.playback.shuffleEnabled),
        ...(typeof value.playback.updatedAt === "string" ? { updatedAt: value.playback.updatedAt } : {}),
      };
    }
  }
  return holder;
}

export function isHolderConflict(error) {
  return error?.code === "PLAYBACK_IN_USE"
    || error?.code === "PLAYBACK_LEASE_LOST"
    || error?.code === "PLAYBACK_NOT_OWNER";
}

export function shouldHandleLeaseLoss(message, activeSessionId, replacingSessionId) {
  if (message?.code !== "PLAYBACK_LEASE_LOST" || !activeSessionId) return false;
  if (message.sessionId && message.sessionId !== activeSessionId) return false;
  return replacingSessionId !== activeSessionId;
}

export function conflictFromError(error) {
  if (!isHolderConflict(error)) return null;
  return {
    message: error.message,
    holder: normalizeHolderSession(error.activeSession),
  };
}
