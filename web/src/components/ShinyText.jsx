import { useEffect, useState } from "react";

export function ShinyText({
  text,
  children,
  disabled = false,
  speed = 3.5,
  className = "",
  color = "rgba(255, 255, 255, 0.75)",
  shineColor = "#ffffff",
  style = {},
  ...props
}) {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mediaQuery.matches);
    const handler = (e) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener?.("change", handler);
    return () => mediaQuery.removeEventListener?.("change", handler);
  }, []);

  const content = text ?? children;
  const isAnimated = !disabled && !prefersReducedMotion;

  return (
    <span
      className={`shiny-text ${isAnimated ? "shiny-text--animated" : ""} ${className}`.trim()}
      style={{
        "--shiny-speed": `${speed}s`,
        "--shiny-base": color,
        "--shiny-glow": shineColor,
        ...style,
      }}
      {...props}
    >
      {content}
    </span>
  );
}

export default ShinyText;
