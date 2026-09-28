import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faClosedCaptioning } from "@fortawesome/free-solid-svg-icons/faClosedCaptioning";
import { faCheck } from "@fortawesome/free-solid-svg-icons/faCheck";
import { faWandMagicSparkles } from "@fortawesome/free-solid-svg-icons/faWandMagicSparkles";

export function formatLanguageLabel(langCode) {
  if (!langCode || langCode === "und") return "Unknown";
  try {
    const displayName = new Intl.DisplayNames(["id", "en"], { type: "language" }).of(langCode);
    if (displayName) {
      return displayName.charAt(0).toUpperCase() + displayName.slice(1);
    }
  } catch {
    // Fallback below
  }
  const map = {
    ind: "Indonesia",
    eng: "English",
    jpn: "Jepang",
    spa: "Spanyol",
    fra: "Prancis",
    deu: "Jerman",
    zho: "Mandarin",
    kor: "Korea",
  };
  return map[langCode.toLowerCase()] || langCode.toUpperCase();
}

export function SubtitlesMenu({
  subtitles = [],
  selectedSubtitleId = null,
  subtitleMode = "ass", // 'ass' | 'vtt'
  onSelectSubtitle,
  onSelectMode,
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  if (!Array.isArray(subtitles) || subtitles.length === 0) {
    return null;
  }

  const selectedTrack = subtitles.find((s) => s.id === selectedSubtitleId);
  const isActive = Boolean(selectedSubtitleId);

  return (
    <div className="relative inline-block" ref={menuRef}>
      <button
        type="button"
        className={`video-player-ctrl-btn ${isActive ? "video-player-ctrl-btn--active" : ""}`}
        aria-label="Subtitles & Captions (C)"
        title="Subtitles & Captions (C)"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        <FontAwesomeIcon icon={faClosedCaptioning} />
      </button>

      {open && (
        <div
          className="video-subtitles-popover"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-label="Subtitles selection menu"
        >
          <div className="video-subtitles-header">
            <span className="video-subtitles-title">Subtitles / Teks</span>
          </div>

          <div className="video-subtitles-list" role="radiogroup">
            {/* Off Option */}
            <button
              type="button"
              className={`video-subtitles-item ${!selectedSubtitleId ? "video-subtitles-item--active" : ""}`}
              onClick={() => {
                onSelectSubtitle?.(null);
                setOpen(false);
              }}
              role="radio"
              aria-checked={!selectedSubtitleId}
            >
              <div className="flex items-center gap-2">
                <span className="w-4 text-center">
                  {!selectedSubtitleId && <FontAwesomeIcon icon={faCheck} className="text-rose-500" />}
                </span>
                <span>Matikan (Off)</span>
              </div>
            </button>

            {/* Subtitle Tracks */}
            {subtitles.map((sub) => {
              const isCurrent = sub.id === selectedSubtitleId;
              const langText = formatLanguageLabel(sub.language);
              const label = sub.title && sub.title !== sub.language ? `${langText} (${sub.title})` : langText;

              return (
                <button
                  key={sub.id}
                  type="button"
                  className={`video-subtitles-item ${isCurrent ? "video-subtitles-item--active" : ""}`}
                  onClick={() => {
                    onSelectSubtitle?.(sub.id);
                  }}
                  role="radio"
                  aria-checked={isCurrent}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-4 text-center">
                      {isCurrent && <FontAwesomeIcon icon={faCheck} className="text-rose-500" />}
                    </span>
                    <span className="truncate">{label}</span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    {sub.hasAssStyling ? (
                      <span className="video-sub-badge video-sub-badge--ass" title="Contains Advanced SubStation Alpha styling & typesetting">
                        <FontAwesomeIcon icon={faWandMagicSparkles} className="text-[10px] mr-1" />
                        ASS (Styled)
                      </span>
                    ) : (
                      <span className="video-sub-badge video-sub-badge--vtt">
                        VTT
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Mode Switch for ASS subtitles */}
          {selectedTrack?.hasAssStyling && (
            <div className="video-subtitles-mode-section">
              <div className="video-subtitles-mode-header">
                <span>Mode Tampilan Subtitle</span>
              </div>

              <div className="video-subtitles-mode-toggle">
                <button
                  type="button"
                  className={`video-subtitles-mode-btn ${subtitleMode === "ass" ? "video-subtitles-mode-btn--active" : ""}`}
                  onClick={() => onSelectMode?.("ass")}
                >
                  Full ASS Styling
                </button>
                <button
                  type="button"
                  className={`video-subtitles-mode-btn ${subtitleMode === "vtt" ? "video-subtitles-mode-btn--active" : ""}`}
                  onClick={() => onSelectMode?.("vtt")}
                >
                  Standard WebVTT
                </button>
              </div>

              <p className="video-subtitles-mode-hint">
                {subtitleMode === "ass"
                  ? "Menampilkan font, warna, efek, dan posisi dialog kustom anime di layar."
                  : "Menampilkan teks standar web browser tanpa efek kustom."}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
