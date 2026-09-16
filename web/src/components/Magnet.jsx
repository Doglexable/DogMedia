import { useEffect, useRef, useState } from "react";

export function Magnet({
  children,
  padding = 40,
  magnetStrength = 0.25,
  disabled = false,
  activeTransition = "transform 0.15s cubic-bezier(0.25, 1, 0.5, 1)",
  inactiveTransition = "transform 0.4s cubic-bezier(0.25, 1, 0.5, 1)",
  className = "",
  style = {},
  ...props
}) {
  const ref = useRef(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isActive, setIsActive] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mediaQuery.matches);
    const handler = (e) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener?.("change", handler);
    return () => mediaQuery.removeEventListener?.("change", handler);
  }, []);

  const handleMouseMove = (e) => {
    if (disabled || prefersReducedMotion || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const distX = e.clientX - centerX;
    const distY = e.clientY - centerY;

    const pullX = distX * magnetStrength;
    const pullY = distY * magnetStrength;

    setPosition({ x: pullX, y: pullY });
    setIsActive(true);
  };

  const handleMouseLeave = () => {
    setPosition({ x: 0, y: 0 });
    setIsActive(false);
  };

  const canAnimate = !disabled && !prefersReducedMotion;

  return (
    <div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={`magnet-wrapper ${className}`.trim()}
      style={{
        display: "inline-flex",
        transform: canAnimate && isActive ? `translate3d(${position.x}px, ${position.y}px, 0)` : "translate3d(0, 0, 0)",
        transition: isActive ? activeTransition : inactiveTransition,
        willChange: "transform",
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}

export default Magnet;
