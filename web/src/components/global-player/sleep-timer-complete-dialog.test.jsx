import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SleepTimerCompleteDialog } from "./sleep-timer-complete-dialog";

describe("SleepTimerCompleteDialog", () => {
  it("explains why playback paused and identifies the current media", () => {
    const markup = renderToStaticMarkup(
      <SleepTimerCompleteDialog
        canResume
        mediaTitle="Night Drive"
        onDismiss={vi.fn()}
        onResume={vi.fn()}
      />
    );

    expect(markup).toContain("Sleep timer finished!");
    expect(markup).toContain("Playback paused. Night Drive is still ready");
  });
});
