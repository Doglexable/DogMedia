import HolderPlatformIcon from "./holder-platform-icon";

export function SpotifyConnectBar({
  conflict,
  canTakeOver = false,
  onTakeOver,
  className = "",
}) {
  if (!conflict) return null;
  const label = conflict.holder?.deviceLabel || "another device";
  const extraClass = className ? ` ${className}` : "";

  return (
    <div
      className={`spotify-connect-bar${extraClass}`}
      role="status"
    >
      {canTakeOver && onTakeOver && (
        <div className="spotify-connect-bar-actions">
          <button
            type="button"
            className="spotify-connect-bar-takeover"
            onClick={(event) => {
              event.stopPropagation();
              onTakeOver();
            }}
          >
            Play here
          </button>
        </div>
      )}
      <div className="spotify-connect-bar-content">
        <HolderPlatformIcon platform={conflict.holder?.platform} className="spotify-connect-bar-icon" />
        <span>Playing on {label}</span>
      </div>
    </div>
  );
}

export default SpotifyConnectBar;
