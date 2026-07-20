export const hiddenMediaStyle = {
  position: "fixed",
  width: 1,
  height: 1,
  opacity: 0,
  pointerEvents: "none",
};

export const playerStyles = {
  miniPlayer: {
    position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 180,
    minHeight: "var(--player-height)", display: "grid", gridTemplateAreas: "var(--player-grid)",
    gridTemplateColumns: "var(--player-columns)", alignItems: "center", gap: "var(--player-gap)",
    padding: "var(--player-padding)", background: "var(--card-bg)",
    borderTop: "1px solid var(--card-border)", boxShadow: "0 -10px 30px rgba(0,0,0,0.16)",
  },
  miniTrack: {
    gridArea: "track", display: "flex", alignItems: "center", gap: 12, minWidth: 0,
    border: "none", background: "transparent", color: "var(--text)", padding: 0,
    textAlign: "left", cursor: "pointer",
  },
  miniThumb: {
    width: "var(--player-thumb)", height: "var(--player-thumb)", flex: "0 0 auto",
    borderRadius: 8, overflow: "hidden", background: "var(--bg)", border: "1px solid var(--card-border)",
  },
  miniTitle: {
    fontSize: "var(--fs-sm)", fontWeight: 700, overflow: "hidden",
    textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  miniMeta: { marginTop: 3, fontSize: "var(--fs-xs)", color: "var(--muted)" },
  playerControls: {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flexWrap: "wrap",
  },
  miniCenter: {
    gridArea: "controls", minWidth: 0, display: "grid", gridTemplateRows: "auto auto",
    gap: 8, justifyItems: "center",
  },
  miniQueueSlot: {
    gridArea: "queue", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6,
  },
  modeButton: (active = false) => ({
    minWidth: "var(--player-control)", height: "var(--player-control)", padding: "0 8px",
    borderRadius: 8, border: active ? "1px solid var(--primary)" : "1px solid var(--card-border)",
    background: active ? "var(--primary)" : "var(--bg)", color: active ? "#fff" : "var(--text)",
    cursor: "pointer", fontSize: "var(--fs-sm)", fontWeight: 800, lineHeight: 1,
  }),
  iconButton: (emphasis = false) => ({
    width: emphasis ? "var(--player-control-main)" : "var(--player-control)",
    height: emphasis ? "var(--player-control-main)" : "var(--player-control)",
    borderRadius: "50%", border: "1px solid var(--card-border)",
    background: emphasis ? "var(--primary)" : "var(--bg)", color: emphasis ? "#fff" : "var(--text)",
    cursor: "pointer", fontSize: emphasis ? "var(--fs-lg)" : "var(--fs-md)", fontWeight: 700, lineHeight: 1,
  }),
  playerProgress: {
    display: "grid", gridTemplateColumns: "var(--player-progress-columns)", alignItems: "center",
    gap: 8, fontSize: "var(--fs-xs)", color: "var(--muted)",
  },
  range: { width: "100%", accentColor: "var(--primary)" },
  fullPage: { minHeight: "100vh", background: "var(--bg)", color: "var(--text)", overflow: "auto" },
  fullHeader: {
    position: "relative", zIndex: 205, minHeight: 58, display: "flex",
    alignItems: "center", justifyContent: "space-between", gap: 16, padding: "0 18px",
    borderBottom: "1px solid var(--card-border)", background: "var(--card-bg)",
  },
  fullMediaBadge: {
    padding: "5px 9px", border: "1px solid var(--card-border)", borderRadius: 999,
    color: "var(--muted)", background: "var(--bg)", fontSize: "var(--fs-xs)", fontWeight: 800,
    letterSpacing: "0.06em", textTransform: "uppercase",
  },
  fullMediaCanvas: {
    minHeight: "calc(100dvh - 58px - var(--player-height))",
    display: "flex", alignItems: "center", justifyContent: "center", padding: 20, boxSizing: "border-box",
  },
  stage: {
    position: "relative", width: "100%", minHeight: "calc(100dvh - 58px - var(--player-height) - 40px)",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  fullAudioElement: {
    position: "fixed", left: "50%", bottom: 28, zIndex: 190, transform: "translateX(-50%)",
    width: "min(calc(100vw - 32px), 560px)",
  },
  fullVideoElement: {
    position: "fixed", left: "50%", top: "calc((100dvh - var(--player-height) + 58px) / 2)",
    zIndex: 150, transform: "translate(-50%, -50%)", width: "auto", height: "auto",
    maxWidth: "calc(100vw - 40px)", maxHeight: "calc(100dvh - 58px - var(--player-height) - 40px)",
    borderRadius: 10, background: "#000", boxShadow: "0 20px 60px rgba(0,0,0,0.24)",
  },
  fullImage: {
    display: "block", maxWidth: "100%", maxHeight: "calc(100dvh - 58px - var(--player-height) - 40px)",
    margin: "0 auto", borderRadius: 10, objectFit: "contain", boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
  },
  titleOverlay: {
    position: "absolute", top: 16, left: 16, zIndex: 190, color: "#fff",
    fontSize: "var(--fs-lg)", fontWeight: 700, pointerEvents: "none",
    textShadow: "0 1px 4px rgba(0,0,0,.7)",
  },
  navButton: (side) => ({
    position: "absolute", top: "50%", transform: "translateY(-50%)", [side]: 16, zIndex: 190,
    width: "calc(var(--player-control-main) + 6px)", height: "calc(var(--player-control-main) + 6px)",
    display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%",
    background: "rgba(0,0,0,.5)", color: "#fff", fontSize: "var(--fs-lg)", lineHeight: 1,
    border: "none", cursor: "pointer",
  }),
  resumeButton: {
    border: "none", borderRadius: 6, background: "rgba(0,0,0,.68)", color: "#fff",
    cursor: "pointer", fontSize: "var(--fs-md)", padding: "10px 18px",
  },
  resumePrompt: {
    position: "fixed", left: "50%", bottom: "calc(var(--player-height) + 18px)",
    transform: "translateX(-50%)", zIndex: 210,
  },
  queuePanel: {
    position: "fixed", right: 12, bottom: "calc(var(--player-height) + 14px)", zIndex: 220,
    width: "min(420px, calc(100vw - 24px))",
    maxHeight: "min(520px, calc(100dvh - var(--player-height) - 40px))", display: "flex", flexDirection: "column",
    overflow: "hidden", border: "1px solid var(--card-border)", borderRadius: 8,
    background: "var(--card-bg)", color: "var(--text)", boxShadow: "0 18px 50px rgba(0,0,0,0.28)",
  },
  queueHeader: {
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
    padding: "12px 14px", borderBottom: "1px solid var(--card-border)",
  },
  queueList: { overflowY: "auto", padding: 8 },
  queueItem: (active = false) => ({
    display: "grid", gridTemplateColumns: "32px minmax(0, 1fr) auto", alignItems: "center", gap: 10,
    width: "100%", padding: "9px 10px", border: active ? "1px solid var(--primary)" : "1px solid transparent",
    borderRadius: 7, background: active ? "color-mix(in srgb, var(--primary) 12%, var(--card-bg))" : "transparent",
    color: "var(--text)", cursor: "pointer", textAlign: "left",
  }),
  queueActionButton: {
    width: 26, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center",
    border: "none", borderRadius: 5, background: "transparent", color: "var(--muted)", cursor: "grab",
    touchAction: "none",
  },
  queueSelectButton: {
    minWidth: 0, padding: 0, border: "none", background: "transparent", color: "var(--text)",
    cursor: "pointer", textAlign: "left",
  },
  queueClearButton: {
    padding: "6px 10px", border: "1px solid var(--card-border)", borderRadius: 6,
    background: "var(--bg)", color: "var(--text)", cursor: "pointer", fontSize: 12, fontWeight: 700,
  },
};
