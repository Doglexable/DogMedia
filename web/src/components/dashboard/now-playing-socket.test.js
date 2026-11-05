import { afterEach, describe, expect, it, vi } from "vitest";
import { createNowPlayingSocket } from "./now-playing-socket";

class FakeSocket {
  static instances = [];
  constructor() { this.sent = []; FakeSocket.instances.push(this); }
  open() { this.onopen?.(); }
  send(value) { this.sent.push(JSON.parse(value)); }
  message(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
  close() { this.onclose?.(); }
}

afterEach(() => { vi.useRealTimers(); FakeSocket.instances = []; });

describe("now-playing socket", () => {
  it("subscribes after auth, ignores stale revisions, and refreshes after reconnect", async () => {
    vi.useFakeTimers();
    const onSessions = vi.fn();
    const service = createNowPlayingSocket({ onSessions, getTicket: async () => "ticket", url: () => "ws://host", WebSocketImpl: FakeSocket });
    service.start();
    await Promise.resolve();
    const first = FakeSocket.instances[0];
    first.open();
    expect(first.sent).toEqual([{ type: "auth", version: 1, ticket: "ticket" }]);
    first.message({ type: "socket.ready", version: 1 });
    expect(first.sent[1]).toEqual({ type: "now-playing.subscribe", version: 1 });
    first.message({ type: "now-playing.state", version: 1, revision: 2, sessions: [{ mediaId: 17 }] });
    first.message({ type: "now-playing.state", version: 1, revision: 1, sessions: [] });
    expect(onSessions).toHaveBeenCalledTimes(1);
    expect(onSessions).toHaveBeenLastCalledWith([{ mediaId: 17 }]);
    first.close();
    expect(onSessions).toHaveBeenLastCalledWith([]);
    await vi.advanceTimersByTimeAsync(500);
    const second = FakeSocket.instances[1];
    second.open();
    second.message({ type: "socket.ready", version: 1 });
    second.message({ type: "now-playing.state", version: 1, revision: 0, sessions: [{ mediaId: 18 }] });
    expect(onSessions).toHaveBeenLastCalledWith([{ mediaId: 18 }]);
    service.stop();
  });
});
