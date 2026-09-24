const BROWSE_MEDIA_THRESHOLD = 8;

export function shouldShowBrowse({ hasSearch = false, mediaCount = 0 } = {}) {
  return Boolean(hasSearch) || Number(mediaCount) > BROWSE_MEDIA_THRESHOLD;
}
