import { useEffect, useState } from "react";
import { api, apiUrl } from "../api";

const PLATFORMS = [
  { id: "linux", label: "Linux" },
  { id: "windows", label: "Windows" },
  { id: "macos", label: "macOS" },
];

export function detectDesktopPlatform(navigatorInfo) {
  const userAgent = navigatorInfo?.userAgent || "";
  if (/Android|iPhone|iPad|iPod/i.test(userAgent)) return null;
  const platform = navigatorInfo?.userAgentData?.platform || navigatorInfo?.platform || userAgent;
  if (/mac/i.test(platform) && navigatorInfo?.maxTouchPoints > 1) return null;
  if (/win/i.test(platform)) return "windows";
  if (/mac/i.test(platform)) return "macos";
  if (/linux|x11/i.test(platform)) return "linux";
  return null;
}

export function DesktopDownload({ mobile = false }) {
  const [platform, setPlatform] = useState(() => detectDesktopPlatform(typeof navigator === "undefined" ? null : navigator));
  const [releases, setReleases] = useState([]);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    const controller = new AbortController();
    api("/api/desktop-release", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load desktop releases");
        return response.json();
      })
      .then((data) => {
        setReleases(Array.isArray(data?.releases) ? data.releases : []);
        setStatus("ready");
      })
      .catch((error) => {
        if (error.name !== "AbortError") setStatus("error");
      });
    return () => controller.abort();
  }, []);

  const selected = releases.filter((release) => release.platform === platform);
  return (
    <div className={`desktop-download${mobile ? " desktop-download--mobile" : ""}`}>
      <div className="desktop-download-title">Download desktop app</div>
      <div className="desktop-download-platforms" aria-label="Desktop platform">
        {PLATFORMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={platform === item.id ? "desktop-download-platform--selected" : ""}
            aria-pressed={platform === item.id}
            onClick={() => setPlatform(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="desktop-download-options" aria-live="polite">
        {status === "loading" && <small>Checking releases…</small>}
        {status === "error" && <small>Could not check available downloads.</small>}
        {status === "ready" && !platform && <small>Choose your computer’s platform.</small>}
        {status === "ready" && platform && selected.length === 0 && <small>No {PLATFORMS.find((item) => item.id === platform)?.label} release published yet.</small>}
        {status === "ready" && selected.map((release) => (
          <a key={release.id} href={apiUrl(`/api/desktop-release/download/${encodeURIComponent(release.id)}`)} download>
            {release.label}
          </a>
        ))}
      </div>
    </div>
  );
}
