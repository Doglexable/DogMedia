import { Component } from "react";
import { isChunkLoadError } from "../utils/lazy-with-retry";

export function ConnectionError({ offline = false }) {
  return (
    <main className="premium-app-shell grid min-h-screen place-items-center px-6 text-center text-content" role="alert">
      <div>
        <h1 className="text-xl font-bold">{offline ? "You're offline" : "This page couldn't load"}</h1>
        <p className="mt-2 text-sm text-muted">
          {offline ? "Reconnect to load this page." : "Check your connection, then try again."}
        </p>
        <button type="button" className="mt-5 rounded-full bg-primary px-5 py-2 text-sm font-bold text-white" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    </main>
  );
}

export class AppErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (isChunkLoadError(this.state.error)) {
      return <ConnectionError offline={typeof navigator !== "undefined" && navigator.onLine === false} />;
    }
    throw this.state.error;
  }
}
