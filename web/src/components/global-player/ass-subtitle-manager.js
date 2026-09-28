let JassubClass = null;
let workerUrl = null;
let wasmUrl = null;

export async function loadJassub() {
  if (!JassubClass) {
    const [jassubMod, workerMod, wasmMod] = await Promise.all([
      import("jassub"),
      import("jassub/dist/wasm/jassub-worker.js?url"),
      import("jassub/dist/wasm/jassub-worker.wasm?url"),
    ]);
    JassubClass = jassubMod.default || jassubMod;
    workerUrl = workerMod.default;
    wasmUrl = wasmMod.default;
  }
  return { JASSUB: JassubClass, workerUrl, wasmUrl };
}

export class AssSubtitleController {
  constructor(videoElement) {
    this.video = videoElement;
    this.instance = null;
    this.currentSubUrl = null;
  }

  async attach(subUrl) {
    if (this.currentSubUrl === subUrl && this.instance) {
      return;
    }

    this.destroy();
    this.currentSubUrl = subUrl;

    if (!subUrl || !this.video) return;

    try {
      const [{ JASSUB, workerUrl: wUrl, wasmUrl: wmUrl }, res] = await Promise.all([
        loadJassub(),
        fetch(subUrl),
      ]);

      if (this.currentSubUrl !== subUrl) return; // url changed while loading
      if (!res.ok) {
        throw new Error(`Failed to load ASS subtitles: HTTP ${res.status}`);
      }

      const subContent = await res.text();
      if (this.currentSubUrl !== subUrl) return;

      this.instance = new JASSUB({
        video: this.video,
        subContent,
        workerUrl: wUrl,
        wasmUrl: wmUrl,
        asyncRender: true,
      });
    } catch (error) {
      console.warn("Failed to initialize ASS subtitle renderer:", error);
      this.destroy();
      throw error;
    }
  }

  destroy() {
    if (this.instance) {
      try {
        this.instance.destroy();
      } catch {
        // Ignored
      }
      this.instance = null;
    }
    this.currentSubUrl = null;
  }
}
