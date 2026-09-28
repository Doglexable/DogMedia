export function shouldShowBrowse({ hasSearch = false, mediaCount = 0 } = {}) {
  return Boolean(hasSearch) || Number(mediaCount) > 0;
}
