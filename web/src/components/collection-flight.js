import { icon } from "@fortawesome/fontawesome-svg-core";
import { faBookmark } from "@fortawesome/free-solid-svg-icons/faBookmark";
import { faList } from "@fortawesome/free-solid-svg-icons/faList";
import { categoryThumbnailUrl, mediaThumbnailUrl } from "../api";

const TARGETS = {
  favorites: 'a[href="/?view=liked"]',
  queue: '[aria-label="Queue"], [aria-label="Queue (Q)"]',
};

function center(rect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function visibleRect(element) {
  if (!element?.isConnected) return null;
  if (element.closest?.('[aria-hidden="true"], [inert]')) return null;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height || rect.bottom < 0 || rect.right < 0
    || rect.top > window.innerHeight || rect.left > window.innerWidth) return null;
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return null;
  return rect;
}

export function captureCollectionOrigin(element) {
  if (typeof document === "undefined") return null;
  const candidate = element?.getBoundingClientRect ? element : document.activeElement;
  if (candidate === document.body || candidate === document.documentElement) return null;
  const rect = visibleRect(candidate);
  return rect ? center(rect) : null;
}

function targetFor(kind, origin) {
  const candidates = [...document.querySelectorAll(TARGETS[kind])]
    .map((element) => ({ element, rect: visibleRect(element) }))
    .filter(({ rect }) => rect);
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const distance = ({ rect }) => {
      const point = center(rect);
      return origin ? (point.x - origin.x) ** 2 + (point.y - origin.y) ** 2 : 0;
    };
    return distance(a) - distance(b);
  });
  return candidates[0];
}

function glyph(kind) {
  const symbol = document.createElement("span");
  symbol.className = "collection-flight-glyph";
  symbol.setAttribute("aria-hidden", "true");
  symbol.innerHTML = icon(kind === "favorites" ? faBookmark : faList).html.join("");
  return symbol;
}

function pulse(element) {
  if (!element?.isConnected || !element.animate) return;
  const iconElement = element.querySelector("svg") || element;
  iconElement.animate([
    { transform: "scale(1)", filter: "brightness(1)" },
    { transform: "scale(1.4)", filter: "brightness(1.7)" },
    { transform: "scale(1)", filter: "brightness(1)" },
  ], { duration: 380, easing: "ease-out" });
}

export function animateCollectionAdd(kind, origin, item, { category = false } = {}) {
  if (typeof document === "undefined" || !TARGETS[kind]) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const target = targetFor(kind, origin);
  const destination = target ? center(target.rect) : { x: window.innerWidth - 44, y: window.innerHeight - 100 };
  const dock = target ? null : document.createElement("div");
  if (dock) {
    dock.className = `collection-flight-dock collection-flight-dock--${kind}`;
    dock.setAttribute("aria-hidden", "true");
    dock.append(glyph(kind));
    document.body.append(dock);
  }
  if (!origin) {
    pulse(target?.element || dock);
    if (dock) window.setTimeout(() => dock.remove(), 650);
    return;
  }

  const flight = document.createElement("div");
  flight.className = `collection-flight collection-flight--${kind}`;
  flight.setAttribute("aria-hidden", "true");
  flight.style.left = `${origin.x - 27}px`;
  flight.style.top = `${origin.y - 27}px`;
  const initial = document.createElement("span");
  initial.className = "collection-flight-initial";
  initial.textContent = String(item?.title || item?.name || "♪").trim().slice(0, 1).toUpperCase();
  flight.append(initial);
  const thumbnail = category ? categoryThumbnailUrl(item) : mediaThumbnailUrl(item);
  if (thumbnail) {
    const image = document.createElement("img");
    image.alt = "";
    image.src = thumbnail;
    image.onerror = () => image.remove();
    flight.append(image);
  }
  flight.append(glyph(kind));
  document.body.append(flight);

  const dx = destination.x - origin.x;
  const dy = destination.y - origin.y;
  const lift = Math.min(110, Math.max(35, Math.abs(dx) * 0.12));
  const finish = () => {
    flight.remove();
    pulse(target?.element || dock);
    if (dock) window.setTimeout(() => dock.remove(), 650);
  };
  if (!flight.animate) {
    finish();
    return;
  }
  const animation = flight.animate([
    { transform: "translate3d(0, 0, 0) scale(1)", opacity: 1 },
    { transform: `translate3d(${dx * 0.55}px, ${dy * 0.4 - lift}px, 0) scale(0.9)`, opacity: 1, offset: 0.55 },
    { transform: `translate3d(${dx}px, ${dy}px, 0) scale(0.2)`, opacity: 0.2 },
  ], { duration: 680, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" });
  animation.onfinish = finish;
  animation.oncancel = () => {
    flight.remove();
    dock?.remove();
  };
}
