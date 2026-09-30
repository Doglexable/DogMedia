import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 10-band EQ definition per ISO octave standard.
 * Range: 31Hz to 16kHz.
 */
export const EQ_BANDS = [
  { id: "31hz",  label: "31Hz",  frequency: 31,    type: "lowshelf" },
  { id: "62hz",  label: "62Hz",  frequency: 62,    type: "peaking"  },
  { id: "125hz", label: "125Hz", frequency: 125,   type: "peaking"  },
  { id: "250hz", label: "250Hz", frequency: 250,   type: "peaking"  },
  { id: "500hz", label: "500Hz", frequency: 500,   type: "peaking"  },
  { id: "1khz",  label: "1kHz",  frequency: 1000,  type: "peaking"  },
  { id: "2khz",  label: "2kHz",  frequency: 2000,  type: "peaking"  },
  { id: "4khz",  label: "4kHz",  frequency: 4000,  type: "peaking"  },
  { id: "8khz",  label: "8kHz",  frequency: 8000,  type: "peaking"  },
  { id: "16khz", label: "16kHz", frequency: 16000, type: "highshelf" },
];

export const EQ_PRESETS = {
  flat: {
    label: "Flat",
    genres: "Neutral / Default",
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  dialogue: {
    label: "Movie / Dialogue",
    genres: "Film, Video & Voice • Actor Dialogue Boost & Speech Clarity",
    gains: [-4, -2, 1, -1, 1, 3, 6, 4, 1, -2],
  },
  rock: {
    label: "Rock",
    genres: "Alternative Rock, Grunge, Hard Rock, Post-Grunge, Post-Hardcore, Punk Rock, Rock 'n' Roll, Skate Punk",
    gains: [3, 5, 3, 0, 3, 5, 5, 3, 2, 0],
  },
  pop: {
    label: "Pop",
    genres: "Alternative Pop, Baroque Pop, Country, Folk / Indie Folk, Pop",
    gains: [2, 3, 2, 0, 2, 3, 5, 5, 3, 2],
  },
  electronic: {
    label: "Electronic",
    genres: "Electronic, Electronic Rock, New Wave, Synth-Pop",
    gains: [8, 6, 3, -2, -2, 0, 3, 5, 6, 6],
  },
  metal: {
    label: "Metal",
    genres: "Alternative Metal, Djent, Heavy Metal, Metalcore, Nu Metal, Progressive Metal, Rap Metal, Thrash Metal",
    gains: [6, 8, 5, -2, -5, -3, 2, 5, 8, 6],
  },
  popRock: {
    label: "Pop Rock",
    genres: "Emo, Emo Pop, Pop-Punk, Pop Rock, Power Pop, Rap Rock",
    gains: [5, 6, 3, 0, -2, 2, 3, 6, 5, 3],
  },
  funk: {
    label: "Funk / Disco",
    genres: "City Pop, Disco, Funk, J-Pop",
    gains: [5, 8, 6, 2, 0, 2, 3, 5, 6, 5],
  },
  dreamPop: {
    label: "Dream Pop",
    genres: "Art Rock, Britpop, Celtic Rock, Christian Rock, Dream Pop, Experimental Rock, Jangle Pop, Post-Britpop, Progressive Rock, Space Rock",
    gains: [3, 3, 2, 0, 0, 2, 3, 5, 6, 6],
  },
};

const PRESET_ALIASES = {
  vShape: "metal",
  midBite: "rock",
  punchyCrisp: "popRock",
  grooveSlap: "funk",
  brightClean: "pop",
  spatialShimmer: "dreamPop",
  electronicSynth: "electronic",
  movie: "dialogue",
  film: "dialogue",
  video: "dialogue",
  voice: "dialogue",
  dialogueBoost: "dialogue",
  clearVoice: "dialogue",
};

const GAINS_KEY     = "pfs:eq-gains";
const ENABLED_KEY   = "pfs:eq-enabled";
export const TARGET_DB_KEY = "pfs:eq-target-db";
export const GAIN_MIN = -10;
export const GAIN_MAX = 10;
export const PREAMP_GAIN_DB = 0; // Unity gain (0 dB); peaks protected by brickwall limiter
export const PREAMP_LINEAR_GAIN = 1.0;

export function formatGain(val) {
  const num = Number(val) || 0;
  const str = Number.isInteger(num) ? String(num) : num.toFixed(1);
  return num > 0 ? `+${str}` : str;
}

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

export function readStoredTargetDb() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return 0;
    const raw = window.localStorage.getItem(TARGET_DB_KEY);
    if (raw === null || raw === undefined) return 0;
    const num = Number(raw);
    if (Number.isFinite(num)) {
      return Math.min(GAIN_MAX, Math.max(GAIN_MIN, Math.round(num * 2) / 2));
    }
  } catch { /* ignore */ }
  return 0;
}

/**
 * Calculates a uniform shift across all EQ bands so that the maximum band gain (peak)
 * matches targetDb, clamping each resulting band between min and max.
 */
export function calculateTargetShift(gains, targetDb, min = GAIN_MIN, max = GAIN_MAX) {
  if (!Array.isArray(gains) || gains.length === 0) return [];
  const target = Math.min(max, Math.max(min, Number(targetDb) || 0));
  const currentPeak = Math.max(...gains.map(Number));
  const offset = target - currentPeak;
  return gains.map((g) => {
    const shifted = (Number(g) || 0) + offset;
    const stepped = Math.round(shifted * 2) / 2;
    return Math.min(max, Math.max(min, stepped));
  });
}

function detectPreset(gains) {
  if (!Array.isArray(gains)) return "custom";
  for (const [key, preset] of Object.entries(EQ_PRESETS)) {
    if (preset.gains.every((g, i) => Math.abs(g - (gains[i] ?? 0)) < 0.01)) return key;
  }
  return "custom";
}

/**
 * useEqualizer — connects an HTML media element to a 10-band Web Audio EQ graph.
 *
 * @param {React.RefObject<HTMLMediaElement>} mediaRef
 * @returns {{ gains, setGain, setGains, preset, setPreset, eqEnabled, setEqEnabled, targetDb, setTargetDb, adjustToTargetDb, eqBands }}
 */
export function useEqualizer(mediaRef) {
  const [gains, setGainsState] = useState(() => readStoredGains() ?? EQ_PRESETS.flat.gains.slice());
  const [eqEnabled, setEqEnabledState] = useState(() => readStoredEnabled());
  const [targetDb, setTargetDbState] = useState(() => readStoredTargetDb());

  const ctxRef            = useRef(null); // AudioContext
  const sourceRef         = useRef(null); // MediaElementSourceNode
  const preampRef         = useRef(null); // GainNode (preamp unity gain)
  const limiterRef        = useRef(null); // DynamicsCompressorNode (brickwall peak limiter)
  const filtersRef        = useRef([]);   // BiquadFilterNode[]
  const currentElementRef = useRef(null); // Current HTMLMediaElement
  const sourceCacheRef    = useRef(new WeakMap());
  const playListenerRef   = useRef(null);
  const closeTimerRef     = useRef(null);
  const mountedRef        = useRef(false);
  const gainsRef          = useRef(gains);
  const enabledRef        = useRef(eqEnabled);

  gainsRef.current  = gains;
  enabledRef.current = eqEnabled;

  const disconnectGraph = useCallback(() => {
    if (playListenerRef.current && currentElementRef.current) {
      try {
        currentElementRef.current.removeEventListener("play", playListenerRef.current);
      } catch { /* ignore */ }
      playListenerRef.current = null;
    }
    try { sourceRef.current?.disconnect(); } catch { /* already disconnected */ }
    try { preampRef.current?.disconnect(); } catch { /* already disconnected */ }
    for (const filter of filtersRef.current) {
      try { filter.disconnect(); } catch { /* already disconnected */ }
    }
    try { limiterRef.current?.disconnect(); } catch { /* already disconnected */ }
  }, []);

  const ensureFilters = useCallback((ctx) => {
    if (filtersRef.current.length) return filtersRef.current;

    filtersRef.current = EQ_BANDS.map((band, i) => {
      const filter = ctx.createBiquadFilter();
      filter.type            = band.type;
      filter.frequency.value = band.frequency;
      filter.Q.value         = band.type === "peaking" ? 1.4 : 0.7;
      filter.gain.value      = gainsRef.current[i] ?? 0;
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

      const preamp = ctx.createGain();
      preamp.gain.value = PREAMP_LINEAR_GAIN;
      preampRef.current = preamp;

      // Studio-grade brickwall limiter to catch peaks and prevent digital clipping
      // when bands are boosted, without dampening overall volume.
      let finalNode = null;
      if (typeof ctx.createDynamicsCompressor === "function") {
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -0.5;
        limiter.knee.value = 0;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.001;
        limiter.release.value = 0.05;
        limiterRef.current = limiter;
        finalNode = limiter;
      }

      // Chain: source → preamp (unity 0 dB) → f[0] → f[1] → … → f[9] → (limiter) → destination
      source.connect(preamp);
      let node = preamp;
      for (const filter of filters) {
        node.connect(filter);
        node = filter;
      }
      if (finalNode) {
        node.connect(finalNode);
        finalNode.connect(ctx.destination);
      } else {
        node.connect(ctx.destination);
      }

      // Resume suspended context (browsers auto-suspend until user gesture)
      if (ctx.state === "suspended") ctx.resume().catch(() => {});

      const handlePlay = () => {
        if (ctxRef.current?.state === "suspended") {
          ctxRef.current.resume().catch(() => {});
        }
      };
      el.addEventListener("play", handlePlay);
      playListenerRef.current = handlePlay;
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
        preampRef.current = null;
        limiterRef.current = null;
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
    const resolvedKey = PRESET_ALIASES[presetKey] ?? presetKey;
    const preset = EQ_PRESETS[resolvedKey];
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

  const setGains = useCallback((nextGains) => {
    if (!Array.isArray(nextGains)) return;
    const clamped = nextGains.map((g) => Math.min(GAIN_MAX, Math.max(GAIN_MIN, Number(g) || 0)));
    setGainsState(clamped);
    try { window.localStorage.setItem(GAINS_KEY, JSON.stringify(clamped)); } catch { /* ignore */ }
    applyGains(clamped);
  }, [applyGains]);

  const setTargetDb = useCallback((value) => {
    const clamped = Math.min(GAIN_MAX, Math.max(GAIN_MIN, Math.round(Number(value) * 2) / 2));
    setTargetDbState(clamped);
    try { window.localStorage.setItem(TARGET_DB_KEY, String(clamped)); } catch { /* ignore */ }
  }, []);

  const adjustToTargetDb = useCallback((customTarget) => {
    const target = customTarget !== undefined ? Number(customTarget) : targetDb;
    const clampedTarget = Math.min(GAIN_MAX, Math.max(GAIN_MIN, Math.round(target * 2) / 2));
    const next = calculateTargetShift(gainsRef.current, clampedTarget, GAIN_MIN, GAIN_MAX);
    setGainsState(next);
    try { window.localStorage.setItem(GAINS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    applyGains(next);
    if (!enabledRef.current) {
      setEqEnabledState(true);
      try { window.localStorage.setItem(ENABLED_KEY, "true"); } catch { /* ignore */ }
    }
    return next;
  }, [applyGains, targetDb]);

  const preset = detectPreset(gains);

  return {
    eqBands: EQ_BANDS,
    gains,
    preset,
    eqEnabled,
    targetDb,
    setGain,
    setGains,
    setPreset,
    setEqEnabled,
    setTargetDb,
    adjustToTargetDb,
    gainMin: GAIN_MIN,
    gainMax: GAIN_MAX,
    preampGainDb: PREAMP_GAIN_DB,
  };
}
