function isValidIp(v) {
  if (!v) return false;
  const parts = v.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    const n = parseInt(p, 10);
    return n >= 0 && n <= 255 && String(n) === p;
  });
}

// With network_mode: host, we rely entirely on the backend getting the true IP via standard X-Forwarded-For.
// WebRTC local candidate gathering is disabled because it triggers mDNS obfuscation on modern browsers,
// and can falsely grab docker bridge IPs depending on the OS setup.
export function getLocalIp() {
  return Promise.resolve(null);
}

let clientIp = null;

export function setClientIp(ip) {
  clientIp = ip;
}

// Base URL from env (empty string = same origin / Vite proxy in dev)
const API_BASE = import.meta.env.VITE_API_URL ?? "";

export function api(path, options = {}) {
  const headers = { ...options.headers };
  if (clientIp) {
    headers["X-Client-IP"] = clientIp;
  }
  return fetch(`${API_BASE}${path}`, { ...options, headers, credentials: "include" });
}

