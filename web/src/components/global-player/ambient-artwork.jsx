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
  const [loadedSrc, setLoadedSrc] = useState("");
  const hasImage = Boolean(src) && failedSrc !== src;
  const isLoaded = hasImage && loadedSrc === src;

  function handleImageError(event) {
    setFailedSrc(event.currentTarget.getAttribute("src") || src);
    onError?.(event);
  }

  return (
    <span className={`ambient-artwork ${className}`.trim()}>
      {/* The soft layer is rendered only after the main image has loaded, avoiding duplicate network requests. */}
      {isLoaded && (
        <img
          src={src}
          alt=""
          aria-hidden="true"
          className="ambient-artwork__glow"
          draggable={false}
          onContextMenu={onContextMenu || ((event) => event.preventDefault())}
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
            onContextMenu={onContextMenu || ((event) => event.preventDefault())}
            onError={handleImageError}
            onLoad={() => setLoadedSrc(src)}
          />
        ) : fallback}
      </span>
    </span>
  );
}
