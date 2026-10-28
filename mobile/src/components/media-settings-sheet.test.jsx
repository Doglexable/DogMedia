import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ slots: [], cursor: 0 }));

vi.mock("react", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    useEffect: () => {},
    useMemo: (factory) => factory(),
    useState: (initial) => {
      const index = state.cursor++;
      if (!(index in state.slots)) state.slots[index] = initial;
      return [state.slots[index], (value) => { state.slots[index] = value; }];
    },
  };
});
vi.mock("react-native", () => ({
  Modal: "Modal", Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View",
  StyleSheet: { create: (styles) => styles },
}));
vi.mock("../theme", () => ({
  alpha: (color) => color,
  radii: { sm: 8, md: 12, lg: 18, full: 9999 },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  useTheme: () => ({ colors: {
    black: "#000000", white: "#ffffff", primary: "#e11d48", surface: "#1c1c1c",
    text: "#ffffff", muted: "#999999", card: "#181818", cardSoft: "#282828",
    cardBorder: "#444444", cardBorderStrong: "#666666",
  } }),
}));

import { MediaSettingsSheet } from "./media-settings-sheet";

function render(player) {
  state.cursor = 0;
  return MediaSettingsSheet({ visible: true, onClose: vi.fn(), player });
}

function findByLabel(tree, label) {
  if (Array.isArray(tree)) {
    for (const item of tree) {
      const found = findByLabel(item, label);
      if (found) return found;
    }
    return null;
  }
  if (!tree || typeof tree !== "object") return null;
  if (tree.props?.accessibilityLabel === label) return tree;
  return findByLabel(tree.props?.children, label);
}

function playerStub() {
  return {
    currentMedia: { mime_type: "audio/mpeg", available_qualities: ["ori", "high", "med", "low"] },
    quality: "high", actualQuality: "high", playbackRate: 1, sleepTimerRemaining: 0,
    changeQuality: vi.fn(), setPlaybackRate: vi.fn(), setSleepTimer: vi.fn(),
  };
}

beforeEach(() => {
  state.slots = [];
  state.cursor = 0;
});

describe("MediaSettingsSheet", () => {
  it("navigates between Quality, Speed, and Sleep Timer tabs", () => {
    const player = playerStub();
    let tree = render(player);
    expect(findByLabel(tree, "High quality")).toBeTruthy();
    expect(findByLabel(tree, "1.5x playback speed")).toBeNull();

    findByLabel(tree, "Speed").props.onPress();
    tree = render(player);
    expect(findByLabel(tree, "1.5x playback speed")).toBeTruthy();
    expect(findByLabel(tree, "High quality")).toBeNull();

    findByLabel(tree, "Sleep Timer").props.onPress();
    tree = render(player);
    expect(findByLabel(tree, "Set sleep timer for 30 minutes")).toBeTruthy();
    expect(findByLabel(tree, "1.5x playback speed")).toBeNull();
  });

  it("selects an available quality", () => {
    const player = playerStub();
    findByLabel(render(player), "High quality").props.onPress();
    expect(player.changeQuality).toHaveBeenCalledExactlyOnceWith("high");
  });

  it("sets playback speed to 1.5x", () => {
    const player = playerStub();
    findByLabel(render(player), "Speed").props.onPress();
    findByLabel(render(player), "1.5x playback speed").props.onPress();
    expect(player.setPlaybackRate).toHaveBeenCalledExactlyOnceWith(1.5);
  });

  it("sets a 30 minute sleep timer", () => {
    const player = playerStub();
    findByLabel(render(player), "Sleep Timer").props.onPress();
    findByLabel(render(player), "Set sleep timer for 30 minutes").props.onPress();
    expect(player.setSleepTimer).toHaveBeenCalledExactlyOnceWith(30);
  });
});
