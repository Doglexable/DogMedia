import { useEffect, useRef } from "react";

export function SleepTimerCompleteDialog({ canResume, mediaTitle, onDismiss, onResume }) {
  const dismissRef = useRef(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    dismissRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onDismiss]);

  return (
    <div
      className="sleep-timer-complete-overlay"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onDismiss(); }}
    >
      <div
        className="sleep-timer-complete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sleep-timer-complete-title"
        aria-describedby="sleep-timer-complete-description"
      >
        <div className="sleep-timer-complete-icon" aria-hidden="true">☾</div>
        <span className="sleep-timer-complete-kicker">Sleep timer</span>
        <h2 id="sleep-timer-complete-title">Playback paused</h2>
        <p id="sleep-timer-complete-description">
          {mediaTitle ? `${mediaTitle} is still ready at the same position.` : "Your media is still ready at the same position."}
        </p>
        <div className="sleep-timer-complete-actions">
          <button ref={dismissRef} type="button" className="sleep-timer-complete-button" onClick={onDismiss}>
            Keep paused
          </button>
          {canResume && (
            <button type="button" className="sleep-timer-complete-button sleep-timer-complete-button--primary" onClick={onResume}>
              Resume
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
