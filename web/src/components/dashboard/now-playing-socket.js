import { playbackSocketUrl, requestPlaybackSocketTicket } from "../../api";

export function createNowPlayingSocket({
  onSessions,
  getTicket = requestPlaybackSocketTicket,
  url = playbackSocketUrl,
  WebSocketImpl = WebSocket,
}) {
  let socket = null;
  let stopped = false;
  let started = false;
  let reconnectTimer = null;
  let attempt = 0;
  let lastRevision = -1;

  const connect = async () => {
    if (stopped) return;
    try {
      const ticket = await getTicket();
      if (stopped) return;
      const current = new WebSocketImpl(url());
      socket = current;
      current.onopen = () => current.send(JSON.stringify({ type: "auth", version: 1, ticket }));
      current.onmessage = (event) => {
        if (stopped || socket !== current) return;
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.version !== 1) return;
        if (message.type === "socket.ready") {
          attempt = 0;
          lastRevision = -1;
          current.send(JSON.stringify({ type: "now-playing.subscribe", version: 1 }));
        } else if (message.type === "now-playing.state"
          && Number.isSafeInteger(message.revision)
          && message.revision >= lastRevision
          && Array.isArray(message.sessions)) {
          lastRevision = message.revision;
          onSessions(message.sessions);
        } else if (message.type === "protocol.error" && message.code === "ACCESS_DENIED") {
          stopped = true;
          onSessions([]);
          current.close();
        }
      };
      current.onclose = () => {
        if (socket !== current || stopped) return;
        socket = null;
        onSessions([]);
        const delay = Math.min(5000, 500 * 2 ** Math.min(attempt++, 4));
        reconnectTimer = setTimeout(connect, delay);
      };
      current.onerror = () => current.close();
    } catch {
      if (stopped) return;
      onSessions([]);
      const delay = Math.min(5000, 500 * 2 ** Math.min(attempt++, 4));
      reconnectTimer = setTimeout(connect, delay);
    }
  };

  return {
    start() { if (started || stopped) return; started = true; connect(); },
    stop() {
      stopped = true;
      clearTimeout(reconnectTimer);
      socket?.close();
      socket = null;
    },
  };
}
