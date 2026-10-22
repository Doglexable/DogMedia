// Fetch Metadata and Origin limit requests made by other browser pages.
// They are browser signals, not client authentication: native HTTP clients can
// omit or forge them, so account sessions remain the authorization boundary.
export function isAllowedMediaBrowserRequest(request, allowedOrigins = new Set()) {
  const headers = request.headers || {};
  const mode = headers["sec-fetch-mode"];
  if (mode === "navigate" || mode === "nested-navigate") return false;

  const origin = headers.origin;
  const sameOrigin = `${request.protocol}://${headers.host}`;
  const allowedOrigin = typeof origin === "string"
    && (origin === sameOrigin || allowedOrigins.has(origin));
  if (origin && !allowedOrigin) return false;

  const site = headers["sec-fetch-site"];
  if ((site === "cross-site" || site === "same-site") && !allowedOrigin) return false;
  return true;
}
