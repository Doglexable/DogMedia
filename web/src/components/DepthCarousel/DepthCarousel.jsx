import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import "./DepthCarousel.css";

const DEFAULT_ITEMS = [
  { image: "https://picsum.photos/seed/depth1/800/1000", alt: "Slide 1" },
  { image: "https://picsum.photos/seed/depth2/800/1000", alt: "Slide 2" },
  { image: "https://picsum.photos/seed/depth3/800/1000", alt: "Slide 3" },
];

export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export function normalizeCarouselIndex(index, count, loop) {
  if (count <= 0) return 0;
  return loop
    ? ((index % count) + count) % count
    : clamp(index, 0, count - 1);
}

export function getDepthCarouselScale({
  cardHeight,
  cardWidth,
  containerHeight,
  containerWidth,
  spread,
}) {
  const neededWidth = cardWidth + Math.abs(spread) + 80;
  const neededHeight = cardHeight + 48;
  return clamp(Math.min(containerWidth / neededWidth, containerHeight / neededHeight), 0.3, 1);
}

function normalizeItem(item) {
  return typeof item === "string" ? { image: item, alt: "" } : item;
}

export default function DepthCarousel({
  items = DEFAULT_ITEMS,
  renderItem,
  initialIndex = 0,
  ariaLabel = "Depth carousel",
  cardWidth = 300,
  cardHeight = 380,
  radius = 18,
  tint = "#05060a",
  depth = 220,
  spread = 90,
  tilt = 22,
  tiltDirection = "right",
  perspective = 1400,
  visibleCards = 4,
  falloff = 0.2,
  blur = 6,
  duration = 700,
  ease = "power3.out",
  autoplay = false,
  autoplayDelay = 3200,
  loop = true,
  showControls = true,
  showIndicators = true,
  onChange,
  className = "",
}) {
  const data = useMemo(() => (Array.isArray(items) ? items : []).map(normalizeItem), [items]);
  const count = data.length;
  const startingIndex = normalizeCarouselIndex(Math.floor(initialIndex), count, false);

  const rootRef = useRef(null);
  const cardRefs = useRef([]);
  const overlayRefs = useRef([]);
  const posRef = useRef(startingIndex);
  const focusRef = useRef(startingIndex);
  const tweenRef = useRef(null);
  const scaleRef = useRef(1);
  const configRef = useRef({});
  const onChangeRef = useRef(onChange);
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);
  const wheelTimerRef = useRef(null);
  const autoTimerRef = useRef(null);
  const reducedMotionRef = useRef(false);
  const [active, setActive] = useState(startingIndex);

  onChangeRef.current = onChange;
  configRef.current = {
    autoplayDelay,
    blur,
    cardHeight,
    cardWidth,
    count,
    depth,
    duration,
    ease,
    falloff,
    loop,
    spread,
    tilt,
    tiltDirection,
    visibleCards,
  };

  const layout = useCallback((position) => {
    const config = configRef.current;
    if (!config.count) return;
    const direction = config.tiltDirection === "left" ? -1 : 1;

    for (let index = 0; index < config.count; index += 1) {
      const card = cardRefs.current[index];
      if (!card) continue;

      let distance = index - position;
      if (config.loop && config.count > 1) {
        distance = ((distance % config.count) + config.count) % config.count;
        if (distance > config.count / 2) distance -= config.count;
      }

      const behind = Math.max(0, distance);
      const shown = Math.abs(distance) <= config.visibleCards + 0.5;
      const translateZ = -config.depth * distance;
      const translateX = direction * config.spread * distance;
      const rotateY = direction * config.tilt * clamp(distance, 0, 1);
      let opacity = distance < 0 ? Math.max(0, 1 + distance) : 1;
      if (!shown) opacity = 0;

      const brightness = Math.max(0.15, 1 - behind * config.falloff);
      const blurAmount = config.blur > 0
        ? Math.min(config.blur, (behind / Math.max(1, config.visibleCards)) * config.blur)
        : 0;

      card.style.transform = `translate(-50%, -50%) scale(${scaleRef.current}) translateX(${translateX.toFixed(2)}px) translateZ(${translateZ.toFixed(2)}px) rotateY(${rotateY.toFixed(3)}deg)`;
      card.style.opacity = opacity.toFixed(3);
      card.style.filter = `brightness(${brightness.toFixed(3)}) blur(${blurAmount.toFixed(2)}px)`;
      card.style.zIndex = String(Math.round(2000 - distance * 20));
      card.style.pointerEvents = shown && opacity > 0.05 ? "auto" : "none";

      const overlay = overlayRefs.current[index];
      if (overlay) overlay.style.opacity = clamp(behind * config.falloff * 1.25, 0, 0.86).toFixed(3);
    }
  }, []);

  const notify = useCallback((index) => {
    setActive(index);
    onChangeRef.current?.(index, data[index]);
  }, [data]);

  const tweenTo = useCallback((target, animate) => {
    tweenRef.current?.kill();
    const config = configRef.current;
    const proxy = { position: posRef.current };
    tweenRef.current = gsap.to(proxy, {
      position: target,
      duration: animate && !reducedMotionRef.current ? config.duration / 1000 : 0,
      ease: config.ease,
      onUpdate: () => {
        posRef.current = proxy.position;
        layout(proxy.position);
      },
      onComplete: () => {
        if (config.loop && config.count > 0) {
          posRef.current = ((posRef.current % config.count) + config.count) % config.count;
        } else {
          posRef.current = clamp(posRef.current, 0, Math.max(config.count - 1, 0));
        }
        layout(posRef.current);
      },
    });
  }, [layout]);

  const setFocus = useCallback((rawIndex, animate = true) => {
    const config = configRef.current;
    if (!config.count) return;
    const index = normalizeCarouselIndex(rawIndex, config.count, config.loop);
    let delta = index - posRef.current;
    if (config.loop && config.count > 1) {
      delta = ((delta % config.count) + config.count) % config.count;
      if (delta > config.count / 2) delta -= config.count;
    }
    tweenTo(posRef.current + delta, animate);
    if (index !== focusRef.current) {
      focusRef.current = index;
      notify(index);
    }
  }, [notify, tweenTo]);

  const navigateBy = useCallback((step) => {
    setFocus(focusRef.current + step, true);
  }, [setFocus]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      scaleRef.current = getDepthCarouselScale({
        cardHeight: configRef.current.cardHeight,
        cardWidth: configRef.current.cardWidth,
        containerHeight: entry.contentRect.height,
        containerWidth: entry.contentRect.width,
        spread: configRef.current.spread,
      });
      layout(posRef.current);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [layout]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const onWheel = (event) => {
      const config = configRef.current;
      if (config.count < 2) return;
      event.preventDefault();
      tweenRef.current?.kill();
      const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const delta = event.deltaMode === 1 ? rawDelta * 24 : rawDelta;
      posRef.current += clamp(delta / (config.cardWidth * 0.9), -0.6, 0.6);
      if (!config.loop) posRef.current = clamp(posRef.current, 0, config.count - 1);
      layout(posRef.current);
      clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = window.setTimeout(() => setFocus(Math.round(posRef.current), true), 130);
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      root.removeEventListener("wheel", onWheel);
      clearTimeout(wheelTimerRef.current);
    };
  }, [layout, setFocus]);

  const handlePointerDown = useCallback((event) => {
    if (event.target.closest("button, a, input, select, textarea")) return;
    if (configRef.current.count < 2) return;
    tweenRef.current?.kill();
    suppressClickRef.current = false;
    dragRef.current = {
      id: event.pointerId,
      lastTime: performance.now(),
      lastX: event.clientX,
      moved: false,
      startPosition: posRef.current,
      startX: event.clientX,
      velocity: 0,
    };
  }, []);

  const handlePointerMove = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const config = configRef.current;
    const distance = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(distance) > 4) {
      drag.moved = true;
      rootRef.current?.setPointerCapture(drag.id);
    }
    if (!drag.moved) return;
    const now = performance.now();
    drag.velocity = (event.clientX - drag.lastX) / Math.max(now - drag.lastTime, 1);
    drag.lastX = event.clientX;
    drag.lastTime = now;
    const stepWidth = Math.max(config.cardWidth * 0.55 * scaleRef.current, 40);
    posRef.current = drag.startPosition - distance / stepWidth;
    if (!config.loop) posRef.current = clamp(posRef.current, 0, config.count - 1);
    layout(posRef.current);
  }, [layout]);

  const handlePointerEnd = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (!drag.moved) return;
    suppressClickRef.current = true;
    const config = configRef.current;
    const stepWidth = Math.max(config.cardWidth * 0.55 * scaleRef.current, 40);
    const projected = posRef.current - (drag.velocity * 180) / stepWidth;
    setFocus(Math.round(projected), true);
  }, [setFocus]);

  const handleKeyDown = useCallback((event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      navigateBy(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      navigateBy(1);
    }
  }, [navigateBy]);

  const handleCardClick = useCallback((index) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    setFocus(index, true);
  }, [setFocus]);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!autoplay || reducedMotionRef.current || count < 2) return undefined;
    const root = rootRef.current;
    let paused = false;
    const stop = () => clearInterval(autoTimerRef.current);
    const start = () => {
      stop();
      autoTimerRef.current = window.setInterval(() => {
        if (!paused) navigateBy(1);
      }, Math.max(configRef.current.autoplayDelay, 600));
    };
    const pause = () => { paused = true; };
    const resume = () => { paused = false; };
    root?.addEventListener("mouseenter", pause);
    root?.addEventListener("mouseleave", resume);
    root?.addEventListener("focusin", pause);
    root?.addEventListener("focusout", resume);
    start();
    return () => {
      stop();
      root?.removeEventListener("mouseenter", pause);
      root?.removeEventListener("mouseleave", resume);
      root?.removeEventListener("focusin", pause);
      root?.removeEventListener("focusout", resume);
    };
  }, [autoplay, count, navigateBy]);

  useEffect(() => {
    if (!count) {
      focusRef.current = 0;
      posRef.current = 0;
      setActive(0);
      return;
    }
    const next = clamp(focusRef.current, 0, count - 1);
    focusRef.current = next;
    posRef.current = next;
    setActive(next);
    layout(next);
  }, [count, layout]);

  useEffect(() => {
    layout(posRef.current);
  }, [blur, cardHeight, cardWidth, count, depth, falloff, layout, radius, spread, tilt, tiltDirection, visibleCards]);

  useEffect(() => () => {
    tweenRef.current?.kill();
    clearTimeout(wheelTimerRef.current);
    clearInterval(autoTimerRef.current);
  }, []);

  const previousDisabled = !loop && active <= 0;
  const nextDisabled = !loop && active >= count - 1;

  return (
    <div
      ref={rootRef}
      className={`depth-carousel ${className}`.trim()}
      style={{ "--dc-perspective": `${perspective}px` }}
      role="group"
      aria-roledescription="carousel"
      aria-label={ariaLabel}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onKeyDown={handleKeyDown}
    >
      <div className="depth-carousel__stage">
        {data.map((item, index) => (
          <div
            key={item?.id ?? index}
            className="depth-carousel__card"
            ref={(element) => { cardRefs.current[index] = element; }}
            style={{ width: cardWidth, height: cardHeight, borderRadius: radius }}
            aria-roledescription="slide"
            aria-label={`${index + 1} of ${count}`}
            aria-hidden={active !== index}
            onClick={() => handleCardClick(index)}
          >
            <div className="depth-carousel__content">
              {renderItem
                ? renderItem(item, index)
                : <img className="depth-carousel__img" src={item.image} alt={item.alt || ""} draggable={false} />}
            </div>
            <span
              className="depth-carousel__tint"
              ref={(element) => { overlayRefs.current[index] = element; }}
              style={{ background: tint }}
            />
          </div>
        ))}
      </div>

      {showControls && count > 1 && (
        <>
          <button type="button" className="depth-carousel__arrow depth-carousel__arrow--prev" aria-label="Previous slide" disabled={previousDisabled} onPointerDown={(event) => event.stopPropagation()} onClick={() => navigateBy(-1)}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button type="button" className="depth-carousel__arrow depth-carousel__arrow--next" aria-label="Next slide" disabled={nextDisabled} onPointerDown={(event) => event.stopPropagation()} onClick={() => navigateBy(1)}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </>
      )}

      {showIndicators && count > 1 && (
        <div className="depth-carousel__dots" role="tablist" aria-label="Slides">
          {data.map((item, index) => (
            <button
              key={item?.id ?? index}
              type="button"
              role="tab"
              aria-selected={active === index}
              aria-label={`Go to slide ${index + 1}`}
              className={`depth-carousel__dot${active === index ? " is-active" : ""}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setFocus(index, true)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
