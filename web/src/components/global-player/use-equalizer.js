import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 5-band EQ definition.
 * Frequencies chosen for a classic graphic-EQ feel.
 */
export const EQ_BANDS = [
  { id: "sub",      label: "Sub",      frequency: 60,    type: "lowshelf" },
  { id: "bass",     label: "Bass",     frequency: 250,   type: "peaking"  },
  { id: "mid",      label: "Mid",      frequency: 1000,  type: "peaking"  },
  { id: "presence", label: "Presence", frequency: 4000,  type: "peaking"  },
  { id: "treble",   label: "Treble",   frequency: 12000, type: "highshelf" },
];

export const EQ_PRESETS = {
  flat:      { label: "Flat",        gains: [ 0,  0,  0,  0,  0] },
  bass:      { label: "Bass Boost",  gains: [ 6,  4,  0, -1, -2] },
  treble:    { label: "Treble",      gains: [-2, -1,  0,  3,  6] },
  vocal:     { label: "Vocal",       gains: [-2,  0,  4,  3,  1] },
  classical: { label: "Classical",   gains: [ 0,  0, -2,  0,  3] },
};

const GAINS_KEY   = "pfs:eq-gains";
const ENABLED_KEY = "pfs:eq-enabled";
export const GAIN_MIN = -12;
export const GAIN_MAX = 12;

export function getOrCreateMediaElementSource(context, element, sourceCache) {
  const cachedSource = sourceCache.get(element);
  if (cachedSource) return cachedSource;

  const source = context.createMediaElementSource(element);
  sourceCache.set(element, source);
  return source;
}

function readStoredGains() {
  try {
    const raw = window.localStorage.getItem(GAINS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === EQ_BANDS.length) {
      return parsed.map((g) => Math.min(GAIN_MAX, Math.max(GAIN_MIN, Number(g) || 0)));
    }
  } catch { /* ignore */ }
  return null;
}

function readStoredEnabled() {
  try {
    return window.localStorage.getItem(ENABLED_KEY) === "true";
  } catch { return false; }
}

function detectPreset(gains) {
  for (const [key, preset] of Object.entries(EQ_PRESETS)) {
    if (preset.gains.every((g, i) => Math.abs(g - gains[i]) < 0.01)) return key;
  }
  return "custom";
}

/**
 * useEqualizer — connects an HTML media element to a 5-band Web Audio EQ graph.
 *
 * @param {React.RefObject<HTMLMediaElement>} mediaRef
 * @returns {{ gains, setGain, preset, setPreset, eqEnabled, setEqEnabled, eqBands }}
 */
export function useEqualizer(mediaRef) {
  const [gains, setGainsState] = useState(() => readStoredGains() ?? EQ_PRESETS.flat.gains.slice());
  const [eqEnabled, setEqEnabledState] = useState(() => readStoredEnabled());

  const ctxRef            = useRef(null); // AudioContext
  const sourceRef         = useRef(null); // MediaElementSourceNode
  const filtersRef        = useRef([]);   // BiquadFilterNode[]
  const currentElementRef = useRef(null); // Current HTMLMediaElement
  const sourceCacheRef    = useRef(new WeakMap());
  const closeTimerRef     = useRef(null);
  const mountedRef        = useRef(false);
  const gainsRef          = useRef(gains);
  const enabledRef        = useRef(eqEnabled);

  gainsRef.current  = gains;
  enabledRef.current = eqEnabled;

  const disconnectGraph = useCallback(() => {
    try { sourceRef.current?.disconnect(); } catch { /* already disconnected */ }
    for (const filter of filtersRef.current) {
      try { filter.disconnect(); } catch { /* already disconnected */ }
    }
  }, []);

  const ensureFilters = useCallback((ctx) => {
    if (filtersRef.current.length) return filtersRef.current;

    filtersRef.current = EQ_BANDS.map((band, i) => {
      const filter = ctx.createBiquadFilter();
      filter.type            = band.type;
      filter.frequency.value = band.frequency;
      filter.Q.value         = band.type === "peaking" ? 1.0 : 0.7;
      filter.gain.value      = gainsRef.current[i];
      return filter;
    });
    return filtersRef.current;
  }, []);

  // A media element may only ever have one MediaElementSourceNode. Keep that
  // node alive and switch its routing when EQ is toggled instead of recreating it.
  const buildGraph = useCallback(() => {
    const el = mediaRef.current;
    if (!el || !eqEnabled) return;

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = ctxRef.current || new AudioContextClass();
      ctxRef.current = ctx;

      const source = getOrCreateMediaElementSource(ctx, el, sourceCacheRef.current);

      disconnectGraph();
      sourceRef.current = source;
      currentElementRef.current = el;

      const filters = ensureFilters(ctx);

      // Chain: source → f[0] → f[1] → … → f[4] → destination
      let node = source;
      for (const filter of filters) {
        node.connect(filter);
        node = filter;
      }
      node.connect(ctx.destination);

      // Resume suspended context (browsers auto-suspend until user gesture)
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
    } catch (err) {
      console.warn("[EQ] Failed to build audio graph:", err);
    }
  }, [disconnectGraph, ensureFilters, mediaRef, eqEnabled]);

  const bypassGraph = useCallback(() => {
    const ctx = ctxRef.current;
    const source = sourceRef.current;
    if (!ctx || !source) return;

    disconnectGraph();
    try {
      source.connect(ctx.destination);
    } catch (err) {
      console.warn("[EQ] Failed to bypass audio graph:", err);
    }
  }, [disconnectGraph]);

  // ─── Wire graph when EQ is enabled + media element is available ───────────
  useEffect(() => {
    if (eqEnabled) {
      buildGraph();
    } else {
      bypassGraph();
    }
  }, [eqEnabled, buildGraph, bypassGraph]);

  // ─── Rebuild graph when mediaRef target changes (e.g. track swap / video switch)
  useEffect(() => {
    if (!eqEnabled) return;
    const el = mediaRef.current;
    if (!el) return;
    if (currentElementRef.current !== el) {
      buildGraph();
    }
  });

  // Delay disposal by one task so React Strict Mode's simulated unmount can
  // reuse the existing source node. A genuine unmount still closes the context.
  useEffect(() => {
    mountedRef.current = true;
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    return () => {
      mountedRef.current = false;
      disconnectGraph();
      const contextToClose = ctxRef.current;
      closeTimerRef.current = window.setTimeout(() => {
        if (mountedRef.current || ctxRef.current !== contextToClose) return;
        contextToClose?.close().catch(() => {});
        ctxRef.current = null;
        sourceRef.current = null;
        filtersRef.current = [];
        currentElementRef.current = null;
        sourceCacheRef.current = new WeakMap();
        closeTimerRef.current = null;
      }, 0);
    };
  }, [disconnectGraph]);

  // ─── Apply gain changes in real-time ─────────────────────────────────────
  const applyGains = useCallback((nextGains) => {
    const filters = filtersRef.current;
    if (!filters.length) return;
    nextGains.forEach((gain, i) => {
      if (filters[i]) filters[i].gain.value = gain;
    });
  }, []);

  // ─── Public API ───────────────────────────────────────────────────────────
  const setGain = useCallback((bandIndex, value) => {
    const clamped = Math.min(GAIN_MAX, Math.max(GAIN_MIN, Number(value)));
    setGainsState((prev) => {
      const next = prev.slice();
      next[bandIndex] = clamped;
      // Persist
      try { window.localStorage.setItem(GAINS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      // Apply to live filters
      applyGains(next);
      return next;
    });
  }, [applyGains]);

  const setPreset = useCallback((presetKey) => {
    const preset = EQ_PRESETS[presetKey];
    if (!preset) return;
    const next = preset.gains.slice();
    setGainsState(next);
    try { window.localStorage.setItem(GAINS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    applyGains(next);
  }, [applyGains]);

  const setEqEnabled = useCallback((enabled) => {
    setEqEnabledState(enabled);
    try { window.localStorage.setItem(ENABLED_KEY, String(enabled)); } catch { /* ignore */ }
  }, []);

  const preset = detectPreset(gains);

  return {
    eqBands: EQ_BANDS,
    gains,
    preset,
    eqEnabled,
    setGain,
    setPreset,
    setEqEnabled,
    gainMin: GAIN_MIN,
    gainMax: GAIN_MAX,
  };
}
