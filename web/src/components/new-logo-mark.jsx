import "./new-logo-mark.css";

export function NewLogoMark({ className = "", decorative = false, showName = true }) {
  return (
    <span
      className={`dm-new-logo ${className}`.trim()}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "Dogmedia"}
      aria-hidden={decorative ? "true" : undefined}
    >
      <span className="dm-new-logo-symbol" aria-hidden="true">
        <span className="dm-new-logo-curve dm-new-logo-curve--inner" />
        <span className="dm-new-logo-curve dm-new-logo-curve--outer" />
        <span className="dm-new-logo-play" />
      </span>
      {showName && <span className="dm-new-logo-word">dogmedia<span className="dm-new-logo-period">.</span></span>}
    </span>
  );
}
