const tracks = [
  {
    title: "Soft Signal", artist: "Dogmedia Demo", duration: 72, bpm: 92,
    colors: ["#b62c58", "#3b1636"],
    melody: [329.63, 392, 440, 392, 293.66, 329.63, 261.63, 293.66],
    bass: [110, 110, 98, 98, 87.31, 87.31, 98, 98],
  },
  {
    title: "Night Window", artist: "Dogmedia Demo", duration: 84, bpm: 104,
    colors: ["#825284", "#242648"],
    melody: [349.23, 440, 523.25, 440, 392, 349.23, 293.66, 392],
    bass: [116.54, 116.54, 130.81, 130.81, 98, 98, 87.31, 87.31],
  },
  {
    title: "Slow Orbit", artist: "Dogmedia Demo", duration: 66, bpm: 78,
    colors: ["#bd654c", "#4a2434"],
    melody: [261.63, 329.63, 392, 329.63, 246.94, 293.66, 349.23, 293.66],
    bass: [87.31, 87.31, 98, 98, 82.41, 82.41, 73.42, 73.42],
  },
];

const elements = {
  list: document.querySelector("#track-list"),
  title: document.querySelector("#now-title"),
  artist: document.querySelector("#now-artist"),
  number: document.querySelector("#track-number"),
  art: document.querySelector("#mini-art"),
  elapsed: document.querySelector("#elapsed"),
  duration: document.querySelector("#duration"),
  seek: document.querySelector("#seek"),
  volume: document.querySelector("#volume"),
  play: document.querySelector("#toggle-play"),
  previous: document.querySelector("#previous"),
  next: document.querySelector("#next"),
};

let selected = 0;
let playing = false;
let position = 0;
let startedAt = 0;
let nextStep = 0;
let audioContext;
let master;
let scheduler;
let animationFrame;
const liveOscillators = new Set();

function formatTime(seconds) {
  const whole = Math.floor(Math.max(0, seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function currentPosition() {
  return playing && audioContext ? position + audioContext.currentTime - startedAt : position;
}

function render() {
  const track = tracks[selected];
  elements.title.textContent = track.title;
  elements.artist.textContent = track.artist;
  const countStr = `${String(selected + 1).padStart(2, "0")} / ${String(tracks.length).padStart(2, "0")}`;
  elements.number.textContent = countStr;
  const heroCount = document.querySelector("#hero-track-count");
  if (heroCount) heroCount.textContent = countStr;
  elements.duration.textContent = formatTime(track.duration);
  elements.art.style.setProperty("--art-a", track.colors[0]);
  elements.art.style.setProperty("--art-b", track.colors[1]);
  elements.play.textContent = playing ? "Ⅱ" : "▶";
  elements.play.setAttribute("aria-label", playing ? "Jeda" : "Putar");
  elements.play.title = playing ? "Jeda" : "Putar";
  document.body.classList.toggle("is-playing", playing);
  [...elements.list.children].forEach((item, index) => {
    const isCurrent = index === selected;
    item.firstElementChild.classList.toggle("is-active", isCurrent);
    item.firstElementChild.setAttribute("aria-current", isCurrent ? "true" : "false");
    const indicator = item.firstElementChild.querySelector(".track-live-bars");
    if (indicator) {
      indicator.style.display = isCurrent && playing ? "inline-flex" : "none";
    }
  });
  renderProgress();
}

function renderProgress() {
  const elapsed = Math.min(currentPosition(), tracks[selected].duration);
  elements.elapsed.textContent = formatTime(elapsed);
  elements.seek.value = Math.round(elapsed / tracks[selected].duration * 1000);
}

function makeVoice(frequency, when, length, level, type = "sine") {
  const oscillator = audioContext.createOscillator();
  const envelope = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, when);
  envelope.gain.setValueAtTime(0.0001, when);
  envelope.gain.exponentialRampToValueAtTime(level, when + 0.025);
  envelope.gain.exponentialRampToValueAtTime(0.0001, when + length);
  oscillator.connect(envelope).connect(master);
  oscillator.onended = () => liveOscillators.delete(oscillator);
  liveOscillators.add(oscillator);
  oscillator.start(when);
  oscillator.stop(when + length + 0.01);
}

function stopVoices() {
  for (const oscillator of liveOscillators) {
    try { oscillator.stop(); } catch { /* Already stopped. */ }
  }
  liveOscillators.clear();
}

function scheduleAudio() {
  if (!playing || !audioContext) return;
  const track = tracks[selected];
  const beat = 60 / track.bpm;
  const now = audioContext.currentTime;
  const origin = startedAt - position;
  while (origin + nextStep * beat < now + 0.18 && nextStep * beat < track.duration) {
    const step = nextStep;
    const when = Math.max(now + 0.005, origin + step * beat);
    makeVoice(track.melody[step % track.melody.length], when, beat * 0.73, 0.19, "triangle");
    if (step % 2 === 0) makeVoice(track.bass[step % track.bass.length], when, beat * 1.4, 0.24);
    if (step % 4 === 0) makeVoice(55, when, 0.13, 0.3);
    nextStep += 1;
  }
}

function tick() {
  if (!playing) return;
  if (currentPosition() >= tracks[selected].duration) {
    selectTrack((selected + 1) % tracks.length, true);
    return;
  }
  renderProgress();
  animationFrame = requestAnimationFrame(tick);
}

async function play() {
  try {
    if (!audioContext) {
      audioContext = new AudioContext();
      master = audioContext.createGain();
      master.connect(audioContext.destination);
    }
    await audioContext.resume();
  } catch {
    elements.play.title = "Audio tidak tersedia di browser ini";
    return;
  }
  master.gain.value = (Number(elements.volume.value) / 100) ** 2 * 0.4;
  if (position >= tracks[selected].duration) position = 0;
  startedAt = audioContext.currentTime;
  nextStep = Math.ceil(position / (60 / tracks[selected].bpm));
  playing = true;
  scheduler = window.setInterval(scheduleAudio, 60);
  scheduleAudio();
  animationFrame = requestAnimationFrame(tick);
  render();
}

function pause() {
  if (!playing) return;
  position = Math.min(currentPosition(), tracks[selected].duration);
  playing = false;
  window.clearInterval(scheduler);
  cancelAnimationFrame(animationFrame);
  stopVoices();
  render();
}

function selectTrack(index, startPlaying = playing) {
  pause();
  selected = (index + tracks.length) % tracks.length;
  position = 0;
  render();
  if (startPlaying) play();
}

tracks.forEach((track, index) => {
  const li = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "track-row";
  button.setAttribute("aria-label", `Pilih ${track.title}`);
  const number = document.createElement("span");
  number.className = "track-index";
  number.textContent = String(index + 1).padStart(2, "0");
  const artwork = document.createElement("span");
  artwork.className = "track-art";
  artwork.setAttribute("aria-hidden", "true");
  artwork.style.setProperty("--art-a", track.colors[0]);
  artwork.style.setProperty("--art-b", track.colors[1]);
  const copy = document.createElement("span");
  copy.className = "track-copy";
  const title = document.createElement("span");
  title.className = "track-title";
  title.textContent = track.title;
  const artist = document.createElement("span");
  artist.className = "track-artist";
  artist.textContent = track.artist;
  copy.append(title, artist);
  const duration = document.createElement("span");
  duration.className = "track-duration";
  duration.textContent = formatTime(track.duration);
  const liveBars = document.createElement("span");
  liveBars.className = "track-live-bars";
  liveBars.setAttribute("aria-hidden", "true");
  liveBars.innerHTML = "<span></span><span></span><span></span>";
  liveBars.style.display = "none";
  const arrow = document.createElement("span");
  arrow.className = "track-arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "↗";
  button.append(number, artwork, copy, liveBars, duration, arrow);
  button.addEventListener("click", () => selectTrack(index, true));
  li.append(button);
  elements.list.append(li);
});

elements.play.addEventListener("click", () => playing ? pause() : play());
elements.previous.addEventListener("click", () => selectTrack(selected - 1));
elements.next.addEventListener("click", () => selectTrack(selected + 1));
elements.seek.addEventListener("input", () => {
  const resume = playing;
  pause();
  position = Number(elements.seek.value) / 1000 * tracks[selected].duration;
  renderProgress();
  if (resume) play();
});
elements.volume.addEventListener("input", () => {
  if (master) master.gain.value = (Number(elements.volume.value) / 100) ** 2 * 0.4;
});
window.addEventListener("pagehide", () => { pause(); audioContext?.close(); });
render();

// Privacy & Transparency Modal Controller
const modalOverlay = document.querySelector("#privacy-modal");
const openModalBtns = document.querySelectorAll("#open-privacy-btn, #open-privacy-hero-btn, #open-privacy-footer-btn");
const closeModalBtns = document.querySelectorAll("#close-privacy-btn, #modal-confirm-btn");
const tabButtons = document.querySelectorAll(".modal-tab");
const tabPanels = document.querySelectorAll(".modal-panel");

function openPrivacyModal() {
  if (!modalOverlay) return;
  modalOverlay.classList.add("is-open");
  modalOverlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closePrivacyModal() {
  if (!modalOverlay) return;
  modalOverlay.classList.remove("is-open");
  modalOverlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

openModalBtns.forEach((btn) => btn.addEventListener("click", openPrivacyModal));
closeModalBtns.forEach((btn) => btn.addEventListener("click", closePrivacyModal));

modalOverlay?.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closePrivacyModal();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (footerInfoModal) {
      closeFooterModal();
    } else if (modalOverlay?.classList.contains("is-open")) {
      closePrivacyModal();
    }
  }
});

tabButtons.forEach((tabBtn) => {
  tabBtn.addEventListener("click", () => {
    const targetId = tabBtn.getAttribute("data-tab");
    tabButtons.forEach((btn) => {
      btn.classList.remove("is-active");
      btn.setAttribute("aria-selected", "false");
    });
    tabPanels.forEach((panel) => panel.classList.remove("is-active"));

    tabBtn.classList.add("is-active");
    tabBtn.setAttribute("aria-selected", "true");
    const activePanel = document.getElementById(targetId);
    if (activePanel) activePanel.classList.add("is-active");
  });
});

// Theme Switcher Controller (shares the single "theme" key with web media)
const THEME_STORAGE_KEY = "theme";
const THEME_MODES = ["system", "light", "dark"];

function getStoredThemeMode() {
  try {
    const mode = localStorage.getItem(THEME_STORAGE_KEY) || document.documentElement.dataset.themeMode || "system";
    return THEME_MODES.includes(mode) ? mode : "system";
  } catch {
    return document.documentElement.dataset.themeMode || "system";
  }
}

function resolveThemeMode(mode) {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return mode;
}

function updateThemeUI(mode) {
  const labels = {
    system: "Sistem",
    light: "Terang",
    dark: "Gelap",
  };
  const icons = {
    system: "◐",
    light: "☀️",
    dark: "🌙",
  };

  const labelText = `Tema: ${labels[mode] || labels.system}`;
  const iconText = icons[mode] || icons.system;

  const headerLabel = document.querySelector("#theme-label");
  const footerLabel = document.querySelector("#theme-label-footer");
  const headerIcon = document.querySelector("#theme-toggle-btn .theme-icon");
  const footerIcon = document.querySelector("#theme-toggle-footer-btn .theme-icon");
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');

  if (headerLabel) headerLabel.textContent = labelText;
  if (footerLabel) footerLabel.textContent = labelText;
  if (headerIcon) headerIcon.textContent = iconText;
  if (footerIcon) footerIcon.textContent = iconText;

  const resolved = resolveThemeMode(mode);
  if (metaThemeColor) {
    metaThemeColor.setAttribute("content", resolved === "dark" ? "#101116" : "#f8f8f7");
  }
}

function applyThemeMode(mode, persist = true) {
  const resolved = resolveThemeMode(mode);
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme = resolved;

  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      /* ignore if storage is restricted */
    }
  }
  updateThemeUI(mode);
}

function cycleTheme(event) {
  const current = getStoredThemeMode();
  const nextIndex = (THEME_MODES.indexOf(current) + 1) % THEME_MODES.length;
  const next = THEME_MODES[nextIndex];

  if (
    typeof document.startViewTransition !== "function" ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ) {
    applyThemeMode(next, true);
    return;
  }

  const rect = event?.currentTarget?.getBoundingClientRect?.();
  const x = Math.round(rect ? rect.left + rect.width / 2 : window.innerWidth / 2);
  const y = Math.round(rect ? rect.top + rect.height / 2 : window.innerHeight / 2);
  const radius = Math.ceil(
    Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    ),
  );

  const root = document.documentElement;
  root.style.setProperty("--theme-transition-x", `${x}px`);
  root.style.setProperty("--theme-transition-y", `${y}px`);
  root.style.setProperty("--theme-transition-radius", `${radius}px`);
  root.classList.add("theme-view-transition");

  let transition;
  try {
    transition = document.startViewTransition(() => {
      applyThemeMode(next, true);
    });
  } catch {
    root.classList.remove("theme-view-transition");
    root.style.removeProperty("--theme-transition-x");
    root.style.removeProperty("--theme-transition-y");
    root.style.removeProperty("--theme-transition-radius");
    applyThemeMode(next, true);
    return;
  }

  const cleanup = () => {
    root.classList.remove("theme-view-transition");
    root.style.removeProperty("--theme-transition-x");
    root.style.removeProperty("--theme-transition-y");
    root.style.removeProperty("--theme-transition-radius");
  };

  transition?.finished?.then(cleanup, cleanup);
}

const initialMode = getStoredThemeMode();
applyThemeMode(initialMode, false);

document.querySelectorAll("#theme-toggle-btn, #theme-toggle-footer-btn").forEach((btn) => {
  btn.addEventListener("click", cycleTheme);
});

const colorSchemeMedia = window.matchMedia("(prefers-color-scheme: dark)");
colorSchemeMedia.addEventListener("change", (e) => {
  if (getStoredThemeMode() === "system") {
    document.documentElement.dataset.theme = e.matches ? "dark" : "light";
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute("content", e.matches ? "#101116" : "#f8f8f7");
    }
  }
});

// Footer Information Dialog Controller & Parity
const FOOTER_MODAL_DATA = {
  privacy: {
    title: "Privacy & Ownership",
    subtitle: "Local-First Architecture",
    body: `Dogmedia is designed from the ground up for personal data sovereignty and complete privacy.

• Zero Telemetry: No behavioral logging, fingerprinting, or tracking scripts.
• Local Storage: Media files, listening habits, and metadata stay strictly inside your storage volume.
• Direct Streaming: Media chunks are served directly via HTTP Range requests without intermediary cloud proxies.
• Secure Authentication: Scrypt password hashing, Redis-backed sessions, and access tier boundaries.
• Private By Design: You own your collection, your stories, and your rhythm.`,
  },
  terms: {
    title: "Terms of Use",
    subtitle: "Personal Media Space",
    body: `Dogmedia is an independent, personal media library system intended for lawful self-hosted media playback.

• Personal Collection: For organizing and playing audio, video, and photos you lawfully own or have rights to stream.
• Self-Hosted Responsibility: You maintain server access controls, account security, and data preservation.
• Free & Independent: Provided as open software for independent media enthusiasts.`,
  },
  license: {
    title: "Open Source License",
    subtitle: "MIT License",
    body: `Dogmedia is free and open source software licensed under the MIT License.

Copyright (c) 2026 Dogmedia contributors.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files, to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software.`,
  },
  protocol: {
    title: "Direct Streaming Protocol",
    subtitle: "Native HTTP Range Chunking",
    body: `Dogmedia implements native high-performance media chunk streaming:

• HTTP 206 Partial Content: Instant timeline scrubbing and precise video seeking.
• Zero Transcode Latency: Original audio and video bitstreams are preserved without destructive compression.
• Redis Queue Sync: Atomic queue manipulation, WebSocket live state, and persistent resume bookmarks across all your devices.`,
  },
  "desktop-lan": {
    title: "Desktop & LAN Streaming",
    subtitle: "Native Client & Home Network Playback",
    body: `Access your personal media library anywhere on your home network:

• Native Desktop App: Rust Dioxus & Blitz client available for Linux, Windows, and macOS with native media keys and MPRIS integration.
• Cross-Device: Stream to any laptop, desktop, tablet, or Smart TV browser via your server's local IP address.
• Progressive Web App: Install directly from your browser as a standalone desktop application.
• Seamless Continuity: Playback positions, resume states, and favorites sync seamlessly across all your devices.`,
  },
  "self-hosted": {
    title: "Self-Hosted Architecture",
    subtitle: "Independent Technology Stack",
    body: `Built for reliability, speed, and long-term ownership:

• Backend: FastifyJS on Linux
• Database: PostgreSQL with automated migration pipelines
• Cache & Queues: Redis for high-speed queue operations, active sessions, and live state
• Frontend: React and modern web components
• Desktop: Rust Native desktop application
• Mobile: Mobile client (Android APK)
• Deployment: Rootless containerized architecture`,
  },
  credits: {
    title: "Credits & Artworks",
    subtitle: "Community Artists & Creators",
    body: `Dogmedia celebrates the talented community creators who crafted the avatar and emote collection:

• comickergirl (Sarah Leuver) - https://x.com/comickergirl
  Created Francois, Gustave Grave, Lune Journal, Maelle Hug, Monoco Good, Parry It, Sciel Approval, Simon, This Is Fine, Verso Good, Verso LMAO.

• Bugyakis - https://x.com/bugyakis
  Created E33 Flag, Gustave Absolute Cinema, Gustave For Those Who Come After, Lune Beach, Lune When One Falls, Monoco Cry, Monoco Void Baguette, Noco Treasure, Renoir Gommage, Sciel Laugh, Verso Stare.

• IrunoArt - https://x.com/IrunoArt
  Created Alicia Side Eye, Clea Pathetic, Esquie Wheee, Esquie Whooo, Gustave Dance Petals, Maelle Play The Piano, Monoco Feet, Monoco Owowow, Osquio Putain, Sciel Celebration, Verso Tired.

Thank you to all community creators for their wonderful contributions!`,
  },
};

const footerInfoTemplate = document.querySelector("#footer-info-modal-template");
let footerInfoModal = null;
let footerModalTrigger = null;
let previousRootOverflow = "";
let previousBodyOverflow = "";

function openFooterModal(key, trigger) {
  const data = FOOTER_MODAL_DATA[key];
  if (!data || !footerInfoTemplate || footerInfoModal) return;
  const fragment = footerInfoTemplate.content.cloneNode(true);
  footerInfoModal = fragment.querySelector("#footer-info-modal");
  footerInfoModal.querySelector("#footer-info-modal-title").textContent = data.title;
  footerInfoModal.querySelector("#footer-info-modal-subtitle").textContent = data.subtitle;
  footerInfoModal.querySelector("#footer-info-modal-body").textContent = data.body;
  footerInfoModal.querySelector("#footer-info-modal-close").addEventListener("click", closeFooterModal);
  footerInfoModal.addEventListener("click", (event) => {
    if (event.target === footerInfoModal) closeFooterModal();
  });
  footerModalTrigger = trigger;
  previousRootOverflow = document.documentElement.style.overflow;
  previousBodyOverflow = document.body.style.overflow;
  document.body.appendChild(fragment);
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";
  footerInfoModal.querySelector("#footer-info-modal-close").focus();
}

function closeFooterModal() {
  if (!footerInfoModal) return;
  footerInfoModal.remove();
  footerInfoModal = null;
  document.documentElement.style.overflow = previousRootOverflow;
  document.body.style.overflow = previousBodyOverflow;
  footerModalTrigger?.focus();
  footerModalTrigger = null;
}

document.querySelectorAll("[data-modal]").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    openFooterModal(btn.dataset.modal, btn);
  });
});

// Footer mobile collapsible columns
document.querySelectorAll(".site-footer-col-header").forEach((headerBtn) => {
  headerBtn.addEventListener("click", () => {
    const isExpanded = headerBtn.getAttribute("aria-expanded") === "true";
    const nextExpanded = !isExpanded;
    headerBtn.setAttribute("aria-expanded", String(nextExpanded));
    const navCol = headerBtn.closest(".site-footer-nav-col");
    const list = navCol?.querySelector(".site-footer-nav-list");
    const icon = headerBtn.querySelector(".site-footer-col-toggle-icon");
    if (list) list.classList.toggle("site-footer-nav-list--open", nextExpanded);
    if (icon) icon.classList.toggle("site-footer-col-toggle-icon--open", nextExpanded);
  });
});

// Footer copyright year
const copyrightEl = document.querySelector("#footer-copyright");
if (copyrightEl) {
  copyrightEl.textContent = `© ${new Date().getFullYear()} Dogmedia. All rights reserved.`;
}

// ==========================================================================
// Dogmedia Interface Tour / Studio Deck Showcase
// ==========================================================================
(function initPreviewTour() {
  const PREVIEW_DATA = [
    {
      src: "/assets/img/preview-dogmedia/01.webp",
      placeholder: "/assets/img/preview-dogmedia/01-blur.webp",
      tag: "BERANDA & SPOTLIGHT",
      title: "Library & Dashboard",
      coord: "PANEL 01 // LIBRARY_DASHBOARD",
      alt: "Pratinjau antarmuka Dogmedia Library & Dashboard",
    },
    {
      src: "/assets/img/preview-dogmedia/02.webp",
      placeholder: "/assets/img/preview-dogmedia/02-blur.webp",
      tag: "BROWSE & PLAYBACK BAR",
      title: "Koleksi & Mini Player Bar",
      coord: "PANEL 02 // BROWSE_PERSISTENT_BAR",
      alt: "Pratinjau antarmuka Dogmedia Koleksi Folder dan Mini Player Bar",
    },
    {
      src: "/assets/img/preview-dogmedia/03.webp",
      placeholder: "/assets/img/preview-dogmedia/03-blur.webp",
      tag: "IMMERSIVE & SYNCED LYRICS",
      title: "Full Player & Lirik Realtime",
      coord: "PANEL 03 // FULL_PLAYER_LYRICS_EQ",
      alt: "Pratinjau antarmuka Dogmedia Full Player dan Lirik Realtime",
    },
    {
      src: "/assets/img/preview-dogmedia/04.webp",
      placeholder: "/assets/img/preview-dogmedia/04-blur.webp",
      tag: "CREATIVE CARDS & SHARE",
      title: "Pembuat Kartu Lirik Visual",
      coord: "PANEL 04 // LYRIC_CARD_GENERATOR",
      alt: "Pratinjau antarmuka Dogmedia Pembuat Kartu Lirik Visual",
    },
    {
      src: "/assets/img/preview-dogmedia/05.webp",
      placeholder: "/assets/img/preview-dogmedia/05-blur.webp",
      tag: "QUEUE & PLAYLIST MANAGER",
      title: "Panel Antrean Interaktif",
      coord: "PANEL 05 // SLIDEOVER_QUEUE_PANEL",
      alt: "Pratinjau antarmuka Dogmedia Panel Antrean Musik",
    },
  ];

  const imgEl = document.querySelector("#preview-img");
  const blurImgEl = document.querySelector("#preview-img-blur");
  const screenLoader = document.querySelector("#preview-screen-loader");
  const stageEl = document.querySelector("#preview-stage");
  const coordEl = document.querySelector("#preview-bezel-coord");
  const badgeText = document.querySelector("#preview-screen-badge-text");
  const countBadge = document.querySelector("#preview-badge-count");
  const chapters = Array.from(document.querySelectorAll(".preview-chapter-card"));
  const scrubbers = Array.from(document.querySelectorAll(".preview-scrub-item"));
  const prevBtn = document.querySelector("#preview-prev");
  const nextBtn = document.querySelector("#preview-next");
  const zoomBtn = document.querySelector("#preview-zoom");

  const lightbox = document.querySelector("#preview-lightbox");
  const lightboxImg = document.querySelector("#preview-lightbox-img");
  const lightboxBlurImg = document.querySelector("#preview-lightbox-blur");
  const lightboxLoader = document.querySelector("#preview-lightbox-loader");
  const lightboxBadge = document.querySelector("#preview-lightbox-badge");
  const lightboxTitle = document.querySelector("#preview-lightbox-title");
  const lightboxCounter = document.querySelector("#preview-lightbox-counter");
  const lightboxClose = document.querySelector("#preview-lightbox-close");
  const lightboxBackdrop = document.querySelector("#preview-lightbox-backdrop");
  const lightboxPrev = document.querySelector("#preview-lightbox-prev");
  const lightboxNext = document.querySelector("#preview-lightbox-next");
  const floatPrev = document.querySelector("#preview-float-prev");
  const floatNext = document.querySelector("#preview-float-next");

  if (!imgEl || !stageEl) return;

  let currentIndex = 0;
  let stageLoadSession = 0;
  let lightboxLoadSession = 0;

  function loadProgressiveImage(targetImg, blurImg, loaderEl, src, placeholder, alt, getSession, incSession) {
    const session = incSession();
    if (blurImg) {
      blurImg.src = placeholder;
      blurImg.style.opacity = "1";
    }

    targetImg.classList.remove("is-loaded");
    targetImg.classList.add("is-loading");
    if (loaderEl) loaderEl.classList.add("is-active");

    const highRes = new Image();
    highRes.src = src;

    const onReady = () => {
      if (getSession() !== session) return;
      targetImg.src = src;
      if (alt) targetImg.alt = alt;
      targetImg.classList.remove("is-loading");
      targetImg.classList.add("is-loaded");
      if (loaderEl) loaderEl.classList.remove("is-active");

      setTimeout(() => {
        if (getSession() === session && blurImg) {
          blurImg.style.opacity = "0";
        }
      }, 350);
    };

    if (highRes.complete && highRes.naturalWidth > 0) {
      onReady();
    } else {
      highRes.onload = onReady;
      highRes.onerror = onReady;
    }
  }

  // Handle initial image load state
  if (imgEl.complete && imgEl.naturalWidth > 0) {
    imgEl.classList.remove("is-loading");
    imgEl.classList.add("is-loaded");
    if (blurImgEl) blurImgEl.style.opacity = "0";
  } else {
    imgEl.addEventListener("load", () => {
      imgEl.classList.remove("is-loading");
      imgEl.classList.add("is-loaded");
      if (blurImgEl) blurImgEl.style.opacity = "0";
    }, { once: true });
  }

  function setPreview(index, focusTab = false) {
    if (index < 0) index = PREVIEW_DATA.length - 1;
    if (index >= PREVIEW_DATA.length) index = 0;
    currentIndex = index;

    const data = PREVIEW_DATA[currentIndex];

    // Smooth stage switch and progressive blur load
    stageEl.classList.add("is-switching");
    setTimeout(() => {
      loadProgressiveImage(
        imgEl,
        blurImgEl,
        screenLoader,
        data.src,
        data.placeholder,
        data.alt,
        () => stageLoadSession,
        () => ++stageLoadSession,
      );
      if (coordEl) coordEl.textContent = data.coord;
      if (badgeText) badgeText.textContent = data.tag;
      if (countBadge) countBadge.textContent = `PANEL 0${currentIndex + 1} / 0${PREVIEW_DATA.length}`;
      stageEl.classList.remove("is-switching");
    }, 110);

    // Update chapter cards
    chapters.forEach((chapter, i) => {
      const active = i === currentIndex;
      chapter.classList.toggle("is-active", active);
      chapter.setAttribute("aria-selected", String(active));
      if (active && focusTab) chapter.focus();
    });

    // Update timeline scrubbers
    scrubbers.forEach((scrub, i) => {
      const active = i === currentIndex;
      scrub.classList.toggle("is-active", active);
    });

    // Update lightbox elements if open
    if (lightbox && !lightbox.hidden) {
      if (lightboxImg) {
        loadProgressiveImage(
          lightboxImg,
          lightboxBlurImg,
          lightboxLoader,
          data.src,
          data.placeholder,
          data.alt,
          () => lightboxLoadSession,
          () => ++lightboxLoadSession,
        );
      }
      if (lightboxBadge) lightboxBadge.textContent = data.tag;
      if (lightboxTitle) lightboxTitle.textContent = data.title;
      if (lightboxCounter) lightboxCounter.textContent = `0${currentIndex + 1} / 0${PREVIEW_DATA.length}`;
    }
  }

  chapters.forEach((chapter) => {
    chapter.addEventListener("click", () => {
      const idx = parseInt(chapter.dataset.index, 10);
      setPreview(idx);
    });
  });

  scrubbers.forEach((scrub) => {
    scrub.addEventListener("click", () => {
      const idx = parseInt(scrub.dataset.index, 10);
      setPreview(idx);
    });
  });

  if (prevBtn) {
    prevBtn.addEventListener("click", () => setPreview(currentIndex - 1));
  }
  if (nextBtn) {
    nextBtn.addEventListener("click", () => setPreview(currentIndex + 1));
  }

  // Keyboard navigation on stage and chapter deck
  stageEl.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setPreview(currentIndex - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setPreview(currentIndex + 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openLightbox();
    }
  });

  // Lightbox functions
  function openLightbox() {
    if (!lightbox) return;
    const data = PREVIEW_DATA[currentIndex];
    if (lightboxImg) {
      loadProgressiveImage(
        lightboxImg,
        lightboxBlurImg,
        lightboxLoader,
        data.src,
        data.placeholder,
        data.alt,
        () => lightboxLoadSession,
        () => ++lightboxLoadSession,
      );
    }
    if (lightboxBadge) lightboxBadge.textContent = data.tag;
    if (lightboxTitle) lightboxTitle.textContent = data.title;
    if (lightboxCounter) lightboxCounter.textContent = `0${currentIndex + 1} / 0${PREVIEW_DATA.length}`;
    lightbox.hidden = false;
    document.body.style.overflow = "hidden";
    if (lightboxClose) lightboxClose.focus();
  }

  function closeLightbox() {
    if (!lightbox || lightbox.hidden) return;
    lightbox.hidden = true;
    document.body.style.overflow = "";
    if (zoomBtn) zoomBtn.focus();
  }

  if (zoomBtn) {
    zoomBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openLightbox();
    });
  }

  stageEl.addEventListener("click", (e) => {
    if (e.target.closest(".preview-control-arrow") || e.target.closest(".preview-control-zoom")) return;
    openLightbox();
  });

  if (lightboxClose) lightboxClose.addEventListener("click", closeLightbox);
  if (lightboxBackdrop) lightboxBackdrop.addEventListener("click", closeLightbox);
  if (lightboxPrev) lightboxPrev.addEventListener("click", () => setPreview(currentIndex - 1));
  if (lightboxNext) lightboxNext.addEventListener("click", () => setPreview(currentIndex + 1));
  if (floatPrev) floatPrev.addEventListener("click", (e) => { e.stopPropagation(); setPreview(currentIndex - 1); });
  if (floatNext) floatNext.addEventListener("click", (e) => { e.stopPropagation(); setPreview(currentIndex + 1); });

  // Global key navigation
  document.addEventListener("keydown", (e) => {
    if (lightbox && !lightbox.hidden) {
      if (e.key === "Escape") {
        closeLightbox();
      } else if (e.key === "ArrowLeft") {
        setPreview(currentIndex - 1);
      } else if (e.key === "ArrowRight") {
        setPreview(currentIndex + 1);
      }
      return;
    }

    // Number keys 1-5 when preview section is focused or generally active
    if (!["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
      if (e.key >= "1" && e.key <= "5" && e.altKey === false && e.ctrlKey === false && e.metaKey === false) {
        // Check if preview is somewhat in viewport or user is viewing it
        const previewSec = document.querySelector("#preview");
        if (previewSec) {
          const rect = previewSec.getBoundingClientRect();
          if (rect.top < window.innerHeight && rect.bottom > 0) {
            setPreview(parseInt(e.key, 10) - 1);
          }
        }
      }
    }
  });

  // Touch swipe support on screen viewport
  let touchStartX = 0;
  stageEl.addEventListener("touchstart", (e) => {
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });
  stageEl.addEventListener("touchend", (e) => {
    const diff = e.changedTouches[0].screenX - touchStartX;
    if (Math.abs(diff) > 40) {
      if (diff > 0) setPreview(currentIndex - 1);
      else setPreview(currentIndex + 1);
    }
  }, { passive: true });
})();

