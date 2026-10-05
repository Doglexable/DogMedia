export function createPlaybackSocket({ getTicket, url, onStatus, onLease, onError, WebSocketImpl = WebSocket }) {
  let socket = null;
  let stopped = false;
  let started = false;
  let timer = null;
  let attempt = 0;
  let status = "closed";
  let sessionId = null;
  let latestState = null;
  let sequence = 0;
  let lastProgressAt = 0;
  let lastRevision = -1;

  const setStatus = (value) => { status = value; onStatus?.(value); };
  const send = (value) => {
    if (socket?.readyState === WebSocketImpl.OPEN) socket.send(JSON.stringify({ ...value, version: 1 }));
  };
  const publish = (value, { progress = false } = {}) => {
    if (!sessionId) return;
    if (progress && Date.now() - lastProgressAt < 1000) return;
    if (progress) lastProgressAt = Date.now();
    latestState = { ...value, type: "playback.state", sessionId, sequence: ++sequence };
    if (status === "ready") send(latestState);
  };
  const bind = (nextSessionId) => {
    sessionId = nextSessionId || null;
    sequence = 0;
    latestState = null;
    if (status === "ready" && sessionId) send({ type: "session.bind", sessionId });
  };
  const connect = async () => {
    if (stopped) return;
    setStatus(attempt ? "reconnecting" : "connecting");
    try {
      const ticket = await getTicket();
      if (stopped) return;
      const current = new WebSocketImpl(url());
      socket = current;
      current.onopen = () => send({ type: "auth", ticket });
      current.onmessage = (event) => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.version !== 1) return;
        if (message.type === "socket.ready") {
          attempt = 0;
          lastRevision = -1;
          setStatus("ready");
          if (sessionId) send({ type: "session.bind", sessionId });
          if (latestState) send(latestState);
        } else if (message.type === "lease.state" && Number.isSafeInteger(message.revision) && message.revision >= lastRevision) {
          lastRevision = message.revision;
          onLease?.(message);
        } else if (message.type === "protocol.error") onError?.(message);
      };
      current.onclose = () => {
        if (socket !== current || stopped) return;
        socket = null;
        setStatus("reconnecting");
        const delay = Math.min(5000, 500 * 2 ** Math.min(attempt++, 4));
        timer = setTimeout(connect, delay * (0.8 + Math.random() * 0.4));
      };
      current.onerror = () => current.close();
    } catch {
      if (stopped) return;
      setStatus("reconnecting");
      const delay = Math.min(5000, 500 * 2 ** Math.min(attempt++, 4));
      timer = setTimeout(connect, delay * (0.8 + Math.random() * 0.4));
    }
  };
  return {
    start() { if (stopped || started) return; started = true; connect(); },
    bind, publish,
    get status() { return status; },
    stop() {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
      socket = null;
      status = "closed";
    },
  };
}
