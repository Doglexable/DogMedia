import { flushSync } from "react-dom";

function canTransition() {
  return typeof document !== "undefined"
    && typeof document.startViewTransition === "function"
    && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function mediaViewTransitionName(mediaId) {
  const id = String(mediaId ?? "").replace(/[^a-zA-Z0-9_-]/g, "-");
  return id ? `media-${id}` : "none";
}

export function runViewTransition(update, { className } = {}) {
  if (!canTransition()) {
    update();
    return null;
  }

  if (className) document.documentElement.classList.add(className);

  let transition;
  try {
    transition = document.startViewTransition(() => flushSync(update));
  } catch {
    if (className) document.documentElement.classList.remove(className);
    update();
    return null;
  }

  const cleanup = () => {
    if (className) document.documentElement.classList.remove(className);
  };
  transition.finished.then(cleanup, cleanup);
  return transition;
}

export function runThemeViewTransition(update, origin) {
  if (!canTransition()) {
    update();
    return null;
  }

  const x = Math.round(origin?.x ?? window.innerWidth / 2);
  const y = Math.round(origin?.y ?? window.innerHeight / 2);
  const radius = Math.ceil(Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  ));

  const root = document.documentElement;
  root.style.setProperty("--theme-transition-x", `${x}px`);
  root.style.setProperty("--theme-transition-y", `${y}px`);
  root.style.setProperty("--theme-transition-radius", `${radius}px`);

  const transition = runViewTransition(update, { className: "theme-view-transition" });
  const cleanup = () => {
    root.style.removeProperty("--theme-transition-x");
    root.style.removeProperty("--theme-transition-y");
    root.style.removeProperty("--theme-transition-radius");
  };
  transition?.finished.then(cleanup, cleanup);
  return transition;
}
