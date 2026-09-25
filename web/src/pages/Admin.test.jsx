import { File } from "node:buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const categories = [{
  id: 7,
  name: "Anime",
  path: "Anime",
  parent_id: null,
  min_access_tier: 100,
  sort_order: 0,
}];

const hookHarness = vi.hoisted(() => {
  const slots = [];
  let cursor = 0;

  return {
    beginRender() {
      cursor = 0;
    },
    reset() {
      cursor = 0;
      slots.length = 0;
    },
    useCallback(callback) {
      cursor += 1;
      return callback;
    },
    useEffect() {
      cursor += 1;
    },
    useMemo(factory) {
      cursor += 1;
      return factory();
    },
    useState(initialValue) {
      const index = cursor;
      cursor += 1;
      if (!(index in slots)) {
        slots[index] = typeof initialValue === "function" ? initialValue() : initialValue;
      }
      const setValue = (nextValue) => {
        slots[index] = typeof nextValue === "function" ? nextValue(slots[index]) : nextValue;
      };
      return [slots[index], setValue];
    },
  };
});

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  refreshCategories: vi.fn(),
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal()),
  useCallback: hookHarness.useCallback,
  useEffect: hookHarness.useEffect,
  useMemo: hookHarness.useMemo,
  useState: hookHarness.useState,
}));

vi.mock("../access-context", () => ({
  useAccess: () => ({ tier: 100 }),
}));

vi.mock("../api", () => ({
  api: mocks.api,
  apiUrl: (path) => path,
  categoryThumbnailUrl: () => "",
  mediaThumbnailUrl: () => "",
}));

vi.mock("../components/library-shell", () => ({
  useLibrary: () => ({ categories, refreshCategories: mocks.refreshCategories }),
}));

vi.mock("../components/GlobalPlayer", () => ({
  useGlobalPlayerLibrary: () => ({ currentMedia: null }),
}));

vi.mock("../components/admin/category-tree-dnd", () => ({
  CategoryTreeDnd: function CategoryTreeDndMock() {
    return null;
  },
}));

import Admin from "./Admin";

function renderAdmin() {
  hookHarness.beginRender();
  const route = Admin();
  return route.type(route.props);
}

function visit(node, callback) {
  if (Array.isArray(node)) {
    node.forEach((child) => visit(child, callback));
    return;
  }
  if (!node || typeof node !== "object") return;
  callback(node);
  visit(node.props?.children, callback);
}

function findAll(root, predicate) {
  const matches = [];
  visit(root, (node) => {
    if (predicate(node)) matches.push(node);
  });
  return matches;
}

function textContent(node) {
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node || typeof node !== "object") return "";
  if (node.type?.name === "MobileReleaseManager") return textContent(node.type(node.props));
  return textContent(node.props?.children);
}

function findButton(root, label) {
  return findAll(root, (node) => node.type === "button" && textContent(node).trim() === label)[0];
}

function openMediaWorkspace() {
  let tree = renderAdmin();
  const categoryTree = findAll(tree, (node) => node.type?.name === "CategoryTreeDndMock")[0];
  categoryTree.props.onSelect(7);
  tree = renderAdmin();
  findButton(tree, "Upload Here").props.onClick();
  return renderAdmin();
}

function response(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(typeof body === "string" ? body : JSON.stringify(body)),
  };
}

beforeEach(() => {
  hookHarness.reset();
  mocks.api.mockReset();
  mocks.refreshCategories.mockReset().mockResolvedValue(categories);
  vi.stubGlobal("document", {
    body: { style: { overflow: "" } },
    getElementById: () => null,
    querySelectorAll: () => [],
  });
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    clearInterval: vi.fn(),
    confirm: vi.fn(() => true),
    removeEventListener: vi.fn(),
    setInterval: vi.fn(),
  });
});

describe("Admin workspace", () => {
  it("renders the tier-100 release and category controls and switches media tabs", () => {
    let tree = renderAdmin();

    expect(textContent(tree)).toContain("Android release");
    expect(textContent(tree)).toContain("Category Tree");
    expect(findButton(tree, "Upload Here").props.disabled).toBe(true);

    tree = openMediaWorkspace();
    const tabLabels = () => findAll(tree, (node) => node.props?.role === "tab")
      .map((node) => textContent(node));

    expect(tabLabels()).toEqual([
      "Collection0 items",
      "Upload videoAnime or film",
      "Import albumMusic and lyrics",
    ]);
    expect(textContent(tree)).toContain("No media in this category");

    findButton(tree, "Upload videoAnime or film").props.onClick();
    tree = renderAdmin();
    expect(textContent(tree)).toContain("Upload anime or film");

    findButton(tree, "Import albumMusic and lyrics").props.onClick();
    tree = renderAdmin();
    expect(textContent(tree)).toContain("Import a music album");

    findButton(tree, "Collection0 items").props.onClick();
    tree = renderAdmin();
    expect(textContent(tree)).toContain("No media in this category");
  });

  it("stages a video and splits it using the chunk size returned by the API", async () => {
    const uploadedChunks = [];
    mocks.api.mockImplementation(async (path, options = {}) => {
      if (path === "/api/media/uploads") {
        return response({ uploadId: "upload-1", chunkSize: 4 });
      }
      if (path === "/api/media/uploads/upload-1/chunks") {
        uploadedChunks.push({
          index: options.body.get("index"),
          size: options.body.get("chunk").size,
        });
        return response({});
      }
      if (path === "/api/media/uploads/upload-1/complete") {
        return response({ id: 42, title: "Episode 2", mime_type: "video/mp4", track_order: 2 }, { status: 201 });
      }
      if (path === "/api/media?category_id=7") {
        return response([{ id: 42, title: "Episode 2", mime_type: "video/mp4", track_order: 2 }]);
      }
      throw new Error(`Unexpected API call: ${options.method || "GET"} ${path}`);
    });

    let tree = openMediaWorkspace();
    findButton(tree, "Upload videoAnime or film").props.onClick();
    tree = renderAdmin();

    const input = findAll(tree, (node) => node.type === "input" && node.props?.id === "admin-media-file")[0];
    const video = new File([new Uint8Array(10)], "Episode 2.mp4", { type: "video/mp4" });
    input.props.onChange({ target: { files: [video] } });
    tree = renderAdmin();

    expect(textContent(tree)).toContain("1 video selected · 10 B");
    expect(findButton(tree, "Upload 1 video").props.disabled).toBe(false);

    const uploadForm = findAll(tree, (node) => node.type === "form" && textContent(node).includes("Upload 1 video"))[0];
    await uploadForm.props.onSubmit({ preventDefault: vi.fn() });

    expect(uploadedChunks).toEqual([
      { index: "0", size: 4 },
      { index: "1", size: 4 },
      { index: "2", size: 2 },
    ]);
    expect(mocks.api).toHaveBeenCalledWith("/api/media/uploads/upload-1/complete", { method: "POST" });
  });

  it("uploads multiple selected videos sequentially in chunks", async () => {
    const uploadSessions = [];
    const completedUploads = [];
    mocks.api.mockImplementation(async (path, options = {}) => {
      if (path === "/api/media/uploads") {
        const body = JSON.parse(options.body);
        const uploadId = `upload-${uploadSessions.length + 1}`;
        uploadSessions.push({ uploadId, title: body.title, fileName: body.fileName });
        return response({ uploadId, chunkSize: 4 });
      }
      if (path.startsWith("/api/media/uploads/") && path.endsWith("/chunks")) {
        return response({});
      }
      if (path.startsWith("/api/media/uploads/") && path.endsWith("/complete")) {
        const match = path.match(/\/api\/media\/uploads\/(.+)\/complete/);
        completedUploads.push(match[1]);
        return response({ uploadId: match[1], status: "queued" }, { status: 202 });
      }
      if (path === "/api/media/uploads/queue") {
        return response({ jobs: [], summary: { queued: 1, processing: 0, completed: 0, failed: 0 } });
      }
      if (path === "/api/media?category_id=7") {
        return response([]);
      }
      if (path === "/api/categories") {
        return response([{ id: 7, name: "Videos", min_access_tier: 100 }]);
      }
      throw new Error(`Unexpected API call: ${options.method || "GET"} ${path}`);
    });

    let tree = openMediaWorkspace();
    findButton(tree, "Upload videoAnime or film").props.onClick();
    tree = renderAdmin();

    const input = findAll(tree, (node) => node.type === "input" && node.props?.id === "admin-media-file")[0];
    const video1 = new File([new Uint8Array(8)], "Episode 1.mp4", { type: "video/mp4" });
    const video2 = new File([new Uint8Array(8)], "Episode 2.mp4", { type: "video/mp4" });
    input.props.onChange({ target: { files: [video1, video2] } });
    tree = renderAdmin();

    expect(textContent(tree)).toContain("2 video selected · 16 B");
    expect(findButton(tree, "Upload 2 videos").props.disabled).toBe(false);

    const uploadForm = findAll(tree, (node) => node.type === "form" && textContent(node).includes("Upload 2 videos"))[0];
    await uploadForm.props.onSubmit({ preventDefault: vi.fn() });

    expect(uploadSessions).toHaveLength(2);
    expect(uploadSessions[0]).toMatchObject({ uploadId: "upload-1", title: "Episode 1", fileName: "Episode 1.mp4" });
    expect(uploadSessions[1]).toMatchObject({ uploadId: "upload-2", title: "Episode 2", fileName: "Episode 2.mp4" });
    expect(completedUploads).toEqual(["upload-1", "upload-2"]);
  });
});
