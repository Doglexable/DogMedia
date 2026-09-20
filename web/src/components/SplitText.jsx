import { useEffect, useState } from "react";

export function SplitText({
  text = "",
  className = "",
  delay = 35,
  textAlign = "left",
  style = {},
  ...props
}) {
  const [mounted, setMounted] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mediaQuery.matches);
    const handler = (e) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener?.("change", handler);
    return () => mediaQuery.removeEventListener?.("change", handler);
  }, []);

  const words = text ? text.split(" ") : [];
  let charIndex = 0;

  return (
    <span
      className={`split-text ${className}`.trim()}
      aria-label={text}
      style={{
        display: "inline-block",
        textAlign,
        ...style,
      }}
      {...props}
    >
      {words.map((word, wordIdx) => {
        const letters = word.split("");
        const renderedWord = (
          <span
            key={`word-${wordIdx}-${word}`}
            style={{ display: "inline-block", whiteSpace: "nowrap" }}
          >
            {letters.map((char, letterIdx) => {
              const currentIdx = charIndex++;
              const isAnimated = mounted && !prefersReducedMotion;
              return (
                <span
                  key={`char-${wordIdx}-${letterIdx}-${char}`}
                  className="split-text-char"
                  style={{
                    display: "inline-block",
                    opacity: isAnimated ? 1 : 0,
                    transform: isAnimated ? "translate3d(0, 0, 0)" : "translate3d(0, 14px, 0)",
                    transitionProperty: "opacity, transform",
                    transitionDuration: "0.45s",
                    transitionTimingFunction: "cubic-bezier(0.2, 0.9, 0.3, 1)",
                    transitionDelay: `${currentIdx * delay}ms`,
                    willChange: "transform, opacity",
                  }}
                >
                  {char}
                </span>
              );
            })}
            {wordIdx < words.length - 1 && <span>&nbsp;</span>}
          </span>
        );
        return renderedWord;
      })}
    </span>
  );
}

export default SplitText;
