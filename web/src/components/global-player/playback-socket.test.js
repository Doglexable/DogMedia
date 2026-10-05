import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlaybackSocket } from "./playback-socket";

class FakeSocket {
  static OPEN = 1;
  static instances = [];
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; FakeSocket.instances.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  send(value) { this.sent.push(JSON.parse(value)); }
  message(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
  close() { this.readyState = 3; this.onclose?.(); }
}

afterEach(() => { vi.useRealTimers(); FakeSocket.instances = []; });

describe("web playback socket", () => {
  it("authenticates, binds and forwards safe lease state", async () => {
    const onLease = vi.fn();
    const service = createPlaybackSocket({ getTicket: async () => "ticket", url: () => "ws://example/api/playback/socket", onLease, WebSocketImpl: FakeSocket });
    service.start();
    service.start();
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0];
    socket.open();
    expect(socket.sent[0]).toEqual({ type: "auth", version: 1, ticket: "ticket" });
    service.bind("session");
    socket.message({ type: "socket.ready", version: 1 });
    expect(socket.sent[1]).toEqual({ type: "session.bind", version: 1, sessionId: "session" });
    socket.message({ type: "lease.state", version: 1, revision: 1, state: "busy", expiresIn: 20, activeSession: { platform: "mobile" } });
    expect(onLease).toHaveBeenCalledWith(expect.objectContaining({ state: "busy" }));
    service.stop();
  });

  it("reconnects and stops all work on teardown", async () => {
    vi.useFakeTimers();
    const statuses = [];
    const service = createPlaybackSocket({ getTicket: async () => "ticket", url: () => "ws://example", onStatus: (status) => statuses.push(status), WebSocketImpl: FakeSocket });
    service.start();
    await Promise.resolve();
    FakeSocket.instances[0].open();
    FakeSocket.instances[0].message({ type: "socket.ready", version: 1 });
    FakeSocket.instances[0].close();
    await vi.advanceTimersByTimeAsync(700);
    expect(FakeSocket.instances).toHaveLength(2);
    FakeSocket.instances[1].open();
    FakeSocket.instances[1].message({ type: "socket.ready", version: 1 });
    expect(statuses).toEqual(["connecting", "ready", "reconnecting", "reconnecting", "ready"]);
    service.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(FakeSocket.instances).toHaveLength(2);
  });
});
