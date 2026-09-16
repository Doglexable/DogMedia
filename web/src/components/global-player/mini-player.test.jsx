import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MiniPlayer } from "./mini-player";

describe("MiniPlayer", () => {
  it("suppresses rendering for video and photo media", () => {
    const videoMarkup = renderToStaticMarkup(
      <MiniPlayer currentMedia={{ id: 1, title: "Test Video", mime_type: "video/mp4" }} />
    );
    expect(videoMarkup).toBe("");

    const photoMarkup = renderToStaticMarkup(
      <MiniPlayer currentMedia={{ id: 2, title: "Test Photo", mime_type: "image/jpeg" }} />
    );
    expect(photoMarkup).toBe("");
  });

  it("renders when active media is audio", () => {
    const audioMarkup = renderToStaticMarkup(
      <MiniPlayer
        currentMedia={{ id: 3, title: "My Song", mime_type: "audio/mp3", artists: "Muse" }}
        duration={180}
        position={45}
      />
    );
    expect(audioMarkup).toContain("My Song");
    expect(audioMarkup).toContain("Muse");
  });
});
