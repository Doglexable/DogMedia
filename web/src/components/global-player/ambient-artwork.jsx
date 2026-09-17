import { useState } from "react";
import { preload } from "react-dom";

export function AmbientArtwork({
  alt,
  className = "",
  fallback = null,
  fetchPriority,
  height,
  loading,
  onError,
  onContextMenu,
  onLoad,
  priority = false,
  src,
  style,
  width,
}) {
  const [prevSrc, setPrevSrc] = useState(src);
  const [failedSrc, setFailedSrc] = useState("");

  if (prevSrc !== src) {
    setPrevSrc(src);
    setFailedSrc("");
  }

  const hasImage = Boolean(src) && failedSrc !== src;

  if (typeof preload === "function" && priority && hasImage) {
    try {
      preload(src, { as: "image", fetchPriority: "high" });
    } catch {
      // Safe fallback if preload is called in an unsupported environment
    }
  }

  function handleImageError(event) {
    setFailedSrc(event.currentTarget.getAttribute("src") || src);
    onError?.(event);
  }

  const effectiveFetchPriority = fetchPriority ?? (priority ? "high" : undefined);
  const effectiveLoading = loading ?? (priority ? "eager" : undefined);
  const ambientStyle = hasImage
    ? { "--ambient-glow-src": `url(${JSON.stringify(src)})`, ...style }
    : style;

  return (
    <span
      className={`ambient-artwork ${className}`.trim()}
      style={ambientStyle}
    >
      {/* Clipping is limited to this surface so the glow remains unconstrained. */}
      <span className="ambient-artwork__surface">
        {hasImage ? (
          <img
            src={src}
            alt={alt}
            className="ambient-artwork__image"
            draggable={false}
            decoding="async"
            fetchPriority={effectiveFetchPriority}
            loading={effectiveLoading}
            width={width}
            height={height}
            onContextMenu={onContextMenu || ((event) => event.preventDefault())}
            onError={handleImageError}
            onLoad={onLoad}
          />
        ) : fallback}
      </span>
    </span>
  );
}
