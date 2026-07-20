import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faHeart, faMusic } from "@fortawesome/free-solid-svg-icons";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";

export default function SharedLikedMusic() {
  const { token } = useParams();
  const [state, setState] = useState({ loading: true, titles: [], error: "" });

  useEffect(() => {
    api(`/api/public/liked-music/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Shared list not found");
        setState({ loading: false, titles: data.titles, error: "" });
      })
      .catch((error) => setState({ loading: false, titles: [], error: error.message }));
  }, [token]);

  return (
    <main className="premium-app-shell min-h-screen px-4 py-10 text-content sm:px-6 sm:py-16">
      <div className="mx-auto w-full max-w-2xl">
        <Link to="/" className="text-sm font-bold text-primary no-underline transition-opacity hover:opacity-75">DogMedia</Link>
        <section className="glass-surface mt-6 overflow-hidden">
          <header className="border-b border-card-border p-6 sm:p-8">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-xl text-white shadow-lg shadow-black/20">
              <FontAwesomeIcon icon={faHeart} />
            </div>
            <p className="mt-5 text-xs font-black uppercase tracking-[0.18em] text-primary">Shared collection</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight">Liked Music</h1>
            <p className="mt-2 text-sm leading-6 text-muted">A read-only collection of titles. Playback and files remain private.</p>
          </header>

          {state.loading ? (
            <div className="grid gap-3 p-6" aria-label="Loading shared music">
              {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-14 animate-pulse rounded-xl bg-surface" />)}
            </div>
          ) : state.error ? (
            <p role="alert" className="m-6 rounded-xl border border-warning-border bg-warning-bg p-4 text-sm text-warning-text">{state.error}</p>
          ) : state.titles.length === 0 ? (
            <div className="p-10 text-center text-muted"><FontAwesomeIcon icon={faMusic} className="mb-3 text-2xl" /><p>No music is currently shared.</p></div>
          ) : (
            <ol className="m-0 list-none divide-y divide-card-border p-0">
              {state.titles.map((title, index) => (
                <li key={`${title}-${index}`} className="group grid grid-cols-[36px_minmax(0,1fr)] items-center gap-3 px-6 py-4 transition-colors hover:bg-surface">
                  <span className="text-xs font-bold tabular-nums text-muted">{String(index + 1).padStart(2, "0")}</span>
                  <span className="truncate font-bold" title={title}>{title}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </main>
  );
}
