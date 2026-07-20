import { useState } from "react";

export function AmbientArtwork({
  alt,
  className = "",
  fallback = null,
  onError,
  onContextMenu,
  src,
}) {
  const [failedSrc, setFailedSrc] = useState("");
  const hasImage = Boolean(src) && failedSrc !== src;

  function handleImageError(event) {
    setFailedSrc(event.currentTarget.getAttribute("src") || src);
    onError?.(event);
  }

  return (
    <span className={`ambient-artwork ${className}`.trim()}>
      {/* The same source provides color for the soft layer behind the artwork. */}
      {hasImage && (
        <img
          src={src}
          alt=""
          aria-hidden="true"
          className="ambient-artwork__glow"
          draggable={false}
        />
      )}

      {/* Clipping is limited to this surface so the glow remains unconstrained. */}
      <span className="ambient-artwork__surface">
        {hasImage ? (
          <img
            src={src}
            alt={alt}
            className="ambient-artwork__image"
            draggable={false}
            onContextMenu={onContextMenu}
            onError={handleImageError}
          />
        ) : fallback}
      </span>
    </span>
  );
}
