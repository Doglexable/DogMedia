import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTowerBroadcast } from "@fortawesome/free-solid-svg-icons/faTowerBroadcast";
import { faXmark } from "@fortawesome/free-solid-svg-icons/faXmark";
import { Drawer } from "vaul";
import { NowPlayingCard } from "./now-playing-card";
import "./now-playing.css";

const MOBILE_DRAWER_QUERY = "(max-width: 640px)";

function useMobileDrawer() {
  const [mobile, setMobile] = useState(() => (
    typeof window !== "undefined" && window.matchMedia(MOBILE_DRAWER_QUERY).matches
  ));

  useEffect(() => {
    const query = window.matchMedia(MOBILE_DRAWER_QUERY);
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return mobile;
}

export function NowPlayingFloatingPill({ count = 0, firstSession, onClick }) {
  const pillRef = useRef(null);

  useEffect(() => {
    if (typeof document === "undefined" || count <= 0) return undefined;
    const updateOffset = () => {
      const rect = pillRef.current?.getBoundingClientRect();
      const height = rect?.height || pillRef.current?.offsetHeight || 38;
      const topFromBottom = rect && rect.top > 0
        ? Math.max(0, Math.round(window.innerHeight - rect.top))
        : (height + 18);
      document.documentElement.style.setProperty("--active-pill-offset", `${topFromBottom + 12}px`);
    };

    const rafId = typeof requestAnimationFrame !== "undefined"
      ? requestAnimationFrame(updateOffset)
      : setTimeout(updateOffset, 0);
    window.addEventListener("resize", updateOffset);

    let resizeObserver;
    if (typeof ResizeObserver !== "undefined" && pillRef.current) {
      resizeObserver = new ResizeObserver(updateOffset);
      resizeObserver.observe(pillRef.current);
    }

    return () => {
      if (typeof cancelAnimationFrame !== "undefined" && typeof rafId === "number") {
        cancelAnimationFrame(rafId);
      } else {
        clearTimeout(rafId);
      }
      window.removeEventListener("resize", updateOffset);
      resizeObserver?.disconnect();
      document.documentElement.style.removeProperty("--active-pill-offset");
    };
  }, [count]);

  if (count <= 0) return null;

  return (
    <button
      ref={pillRef}
      type="button"
      className="now-playing-floating-pill"
      onClick={onClick}
      aria-label={`Open now playing panel: ${count} active session${count === 1 ? "" : "s"}`}
      title="View active playback sessions on this server"
    >
      <span className="now-playing-floating-pill__dot" aria-hidden="true" />
      <span className="now-playing-floating-pill__icon" aria-hidden="true">
        <FontAwesomeIcon icon={faTowerBroadcast} />
      </span>
      <span className="now-playing-floating-pill__info">
        <span className="now-playing-floating-pill__title">
          {firstSession?.title || "Now Playing"}
        </span>
        <span className="now-playing-floating-pill__count">
          {count} active
        </span>
      </span>
    </button>
  );
}

export function NowPlayingPanel({ sessions = [], onClose }) {
  const [snap, setSnap] = useState(0.88);
  const mobile = useMobileDrawer();
  const panelRef = useRef(null);

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Close on desktop click outside
  useEffect(() => {
    if (mobile) return undefined;
    const handleClickOutside = (event) => {
      if (panelRef.current && !panelRef.current.contains(event.target)) {
        // Only close if not clicking a trigger button
        const isTrigger = event.target.closest?.(".now-playing-floating-pill");
        if (!isTrigger) {
          onClose?.();
        }
      }
    };
    // Delay listener to next tick so current open click isn't captured
    const timer = setTimeout(() => {
      window.addEventListener("mousedown", handleClickOutside);
    }, 50);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousedown", handleClickOutside);
    };
  }, [mobile, onClose]);

  const panelContent = (
    <div
      ref={panelRef}
      className="now-playing-floating-panel"
      role="region"
      aria-label="Active playback sessions on server"
    >
      {/* Header */}
      <div className="now-playing-panel-header">
        <div>
          {mobile ? (
            <>
              <span className="mobile-queue-drawer-kicker">Live on server</span>
              <Drawer.Title className="mobile-queue-drawer-title">Now Playing</Drawer.Title>
              <Drawer.Description className="mobile-queue-drawer-description">
                {sessions.length ? `${sessions.length} active session${sessions.length === 1 ? "" : "s"}` : "No active sessions"}
              </Drawer.Description>
            </>
          ) : (
            <div className="now-playing-panel-title-wrap">
              <div className="now-playing-panel-title-row">
                <span className="now-playing-floating-pill__dot" style={{ width: 7, height: 7 }} />
                <h2 className="now-playing-panel-title">Now Playing</h2>
                <span className="now-playing-panel-count-pill">
                  {sessions.length} active
                </span>
              </div>
              <p className="now-playing-panel-subtitle">
                Active playback sessions on this server
              </p>
            </div>
          )}
        </div>

        <button
          type="button"
          className="now-playing-panel-close-btn"
          onClick={onClose}
          aria-label="Close now playing panel"
          title="Close panel"
        >
          <FontAwesomeIcon icon={faXmark} />
        </button>
      </div>

      {/* Body / Sessions list */}
      <div className="now-playing-panel-body">
        {sessions.length === 0 ? (
          <div className="now-playing-empty-state">
            <div className="now-playing-empty-icon" aria-hidden="true">
              <FontAwesomeIcon icon={faTowerBroadcast} />
            </div>
            <p className="now-playing-empty-title">No active sessions</p>
            <p className="now-playing-empty-desc">
              No devices are currently streaming media from this server.
            </p>
          </div>
        ) : (
          sessions.map((session, index) => (
            <NowPlayingCard
              key={`${session.ip}-${session.mediaId}-${index}`}
              session={session}
              index={index}
            />
          ))
        )}
      </div>
    </div>
  );

  if (!mobile) return panelContent;

  return (
    <Drawer.Root
      open
      onOpenChange={(open) => { if (!open) onClose?.(); }}
      snapPoints={[0.55, 0.88]}
      activeSnapPoint={snap}
      setActiveSnapPoint={setSnap}
      fadeFromIndex={0}
      autoFocus
      handleOnly
      shouldScaleBackground={false}
      setBackgroundColorOnScale={false}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="mobile-player-drawer-overlay" />
        <Drawer.Content className="mobile-player-drawer mobile-now-playing-drawer">
          <Drawer.Handle className="mobile-player-drawer-handle" />
          {panelContent}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

export default NowPlayingPanel;
