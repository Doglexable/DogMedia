import { useEffect, useRef, useState } from "react";

export function Squares({
  direction = "right",
  speed = 0.5,
  borderColor = "rgba(255, 255, 255, 0.08)",
  squareSize = 40,
  hoverFillColor = "rgba(225, 29, 72, 0.18)",
  className = "",
  style = {},
  ...props
}) {
  const canvasRef = useRef(null);
  const requestRef = useRef(null);
  const gridOffset = useRef({ x: 0, y: 0 });
  const hoveredSquareRef = useRef(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mediaQuery.matches);
    const handler = (e) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener?.("change", handler);
    return () => mediaQuery.removeEventListener?.("change", handler);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.resetTransform?.();
      ctx.scale(dpr, dpr);
    };

    resize();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    ro?.observe(canvas);

    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const col = Math.floor((mouseX - gridOffset.current.x) / squareSize);
      const row = Math.floor((mouseY - gridOffset.current.y) / squareSize);
      hoveredSquareRef.current = { col, row };
    };

    const handleMouseLeave = () => {
      hoveredSquareRef.current = null;
    };

    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseleave", handleMouseLeave);

    const render = () => {
      if (!prefersReducedMotion) {
        switch (direction) {
          case "right":
            gridOffset.current.x = (gridOffset.current.x + speed) % squareSize;
            break;
          case "left":
            gridOffset.current.x = (gridOffset.current.x - speed) % squareSize;
            break;
          case "up":
            gridOffset.current.y = (gridOffset.current.y - speed) % squareSize;
            break;
          case "down":
            gridOffset.current.y = (gridOffset.current.y + speed) % squareSize;
            break;
          case "diagonal":
            gridOffset.current.x = (gridOffset.current.x + speed) % squareSize;
            gridOffset.current.y = (gridOffset.current.y + speed) % squareSize;
            break;
          default:
            break;
        }
      }

      ctx.clearRect(0, 0, width, height);

      const startX = Math.floor(gridOffset.current.x % squareSize) - squareSize;
      const startY = Math.floor(gridOffset.current.y % squareSize) - squareSize;

      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;

      for (let x = startX; x < width + squareSize; x += squareSize) {
        for (let y = startY; y < height + squareSize; y += squareSize) {
          const col = Math.floor((x - gridOffset.current.x) / squareSize);
          const row = Math.floor((y - gridOffset.current.y) / squareSize);

          if (
            hoveredSquareRef.current &&
            hoveredSquareRef.current.col === col &&
            hoveredSquareRef.current.row === row
          ) {
            ctx.fillStyle = hoverFillColor;
            ctx.fillRect(x, y, squareSize, squareSize);
          }

          ctx.strokeRect(x, y, squareSize, squareSize);
        }
      }

      requestRef.current = requestAnimationFrame(render);
    };

    requestRef.current = requestAnimationFrame(render);

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      ro?.disconnect();
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [direction, speed, borderColor, squareSize, hoverFillColor, prefersReducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      className={`squares-canvas ${className}`.trim()}
      style={{
        display: "block",
        width: "100%",
        height: "100%",
        ...style,
      }}
      aria-hidden="true"
      {...props}
    />
  );
}

export default Squares;
