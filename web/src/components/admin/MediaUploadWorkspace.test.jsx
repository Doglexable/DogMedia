import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import MediaUploadWorkspace from "./MediaUploadWorkspace";

const styles = {
  button: () => ({}),
  spinner: {},
};

describe("MediaUploadWorkspace folder artwork", () => {
  it("offers removal when shared artwork exists", () => {
    const markup = renderToStaticMarkup(
      <MediaUploadWorkspace
        category={{ id: 7, name: "Album", cover_path: "7/front.webp" }}
        file={null}
        onFileChange={vi.fn()}
        onRemove={vi.fn()}
        onSubmit={vi.fn()}
        removing={false}
        styles={styles}
        updating={false}
      />
    );

    expect(markup).toContain("Replace artwork");
    expect(markup).toContain("Remove artwork");
  });

  it("hides removal when the folder has no shared artwork", () => {
    const markup = renderToStaticMarkup(
      <MediaUploadWorkspace
        category={{ id: 7, name: "Album", cover_path: null }}
        file={null}
        onFileChange={vi.fn()}
        onRemove={vi.fn()}
        onSubmit={vi.fn()}
        removing={false}
        styles={styles}
        updating={false}
      />
    );

    expect(markup).toContain("Attach artwork");
    expect(markup).not.toContain("Remove artwork");
  });
});
