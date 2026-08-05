export function normalizeQueueState(data, mediaId = null) {
  if (!Array.isArray(data?.queue)) return null;

  const queueIds = data.queue.map(Number);
  const mediaIndex = mediaId == null ? -1 : queueIds.indexOf(Number(mediaId));
  const responseIndex = Number.isInteger(data.currentIndex)
    ? Math.min(Math.max(data.currentIndex, 0), Math.max(queueIds.length - 1, 0))
    : 0;

  return {
    queueIds,
    queueItems: Array.isArray(data.items) ? data.items : [],
    queueIndex: mediaIndex >= 0 ? mediaIndex : responseIndex,
  };
}

export function getQueueNavigation(queueIds, queueIndex, loopMode = "none") {
  const hasLinearPrev = queueIndex > 0;
  const hasLinearNext = queueIndex >= 0 && queueIndex < queueIds.length - 1;
  const canWrap = loopMode === "queue" && queueIds.length > 1;

  return {
    hasLinearNext,
    hasLinearPrev,
    hasNext: hasLinearNext || canWrap,
    hasPrev: hasLinearPrev || canWrap,
  };
}

export function getCompletionAction({ hasLinearNext, loopMode, queueLength }) {
  if (loopMode === "media") return "repeat";
  if (hasLinearNext) return "advance";
  if (loopMode === "queue" && queueLength > 0) return "wrap";
  return "stop";
}

export function isValidResumePosition(position, duration = 0) {
  const nextPosition = Math.floor(Number(position) || 0);
  const nextDuration = Math.floor(Number(duration) || 0);
  return nextPosition >= 2 && (!nextDuration || nextPosition < nextDuration - 3);
}
