import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlaybackSocket } from "./playback-socket";

class FakeSocket {
  static OPEN = 1;
  static instances = [];
  constructor() { this.readyState = 0; this.sent = []; FakeSocket.instances.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  send(raw) { this.sent.push(JSON.parse(raw)); }
  message(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
  close() { this.readyState = 3; this.onclose?.(); }
}

afterEach(() => { vi.useRealTimers(); FakeSocket.instances = []; });

describe("mobile shared playback socket", () => {
  it("uses one channel for sequential audio and video bindings", async () => {
    const onLease = vi.fn();
    const service = createPlaybackSocket({ getTicket: async () => "ticket", url: () => "ws://host", onLease, WebSocketImpl: FakeSocket });
    service.start();
    service.start();
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.message({ type: "socket.ready", version: 1 });
    service.bind("audio");
    service.bind("video");
    service.publish({ mediaId: 2, action: "play", position: 0, duration: 10, loopMode: "none", shuffleEnabled: false });
    expect(socket.sent.filter((message) => message.type === "session.bind").map((message) => message.sessionId)).toEqual(["audio", "video"]);
    expect(socket.sent.at(-1)).toMatchObject({ type: "playback.state", sessionId: "video", mediaId: 2 });
    socket.message({ type: "lease.state", version: 1, revision: 1, state: "busy", expiresIn: 10 });
    expect(onLease).toHaveBeenCalledOnce();
    service.stop();
  });

  it("switches to reconnect fallback state and returns to ready", async () => {
    vi.useFakeTimers();
    const statuses = [];
    const service = createPlaybackSocket({ getTicket: async () => "ticket", url: () => "ws://host", onStatus: (status) => statuses.push(status), WebSocketImpl: FakeSocket });
    service.start();
    await Promise.resolve();
    FakeSocket.instances[0].open();
    FakeSocket.instances[0].message({ type: "socket.ready", version: 1 });
    FakeSocket.instances[0].close();
    await vi.advanceTimersByTimeAsync(700);
    FakeSocket.instances[1].open();
    FakeSocket.instances[1].message({ type: "socket.ready", version: 1 });
    expect(statuses).toEqual(["connecting", "ready", "reconnecting", "reconnecting", "ready"]);
    service.stop();
  });

  it("delivers lease-loss before an available state after force release", async () => {
    const events = [];
    const service = createPlaybackSocket({
      getTicket: async () => "ticket",
      url: () => "ws://host",
      onError: (message) => events.push(message.code),
      onLease: (message) => events.push(message.state),
      WebSocketImpl: FakeSocket,
    });
    service.start();
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.message({ type: "socket.ready", version: 1 });
    socket.message({ type: "protocol.error", version: 1, code: "PLAYBACK_LEASE_LOST" });
    socket.message({ type: "lease.state", version: 1, revision: 1, state: "available", expiresIn: 0 });
    expect(events).toEqual(["PLAYBACK_LEASE_LOST", "available"]);
    service.stop();
  });
});
