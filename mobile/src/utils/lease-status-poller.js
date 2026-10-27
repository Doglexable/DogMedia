export function createLeaseStatusPoller({ getStatus, onStatus, intervalMs = 5000 }) {
  let stopped = false;
  let timer = null;

  async function poll() {
    if (stopped) return;
    try {
      const status = await getStatus();
      if (!stopped && status) {
        await onStatus(status);
      }
    } catch {
      // Tolerate transient errors and continue scheduling.
    }
    if (!stopped) {
      timer = setTimeout(poll, intervalMs);
    }
  }

  poll();

  return {
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    isStopped() {
      return stopped;
    },
  };
}
