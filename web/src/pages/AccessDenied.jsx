import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLock } from "@fortawesome/free-solid-svg-icons";

export default function AccessDenied() {
  return (
    <main className="premium-app-shell grid min-h-screen place-items-center p-6 text-content">
      <section className="glass-surface w-full max-w-lg p-8 text-center sm:p-12">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-warning-bg text-2xl text-warning-text shadow-lg">
          <FontAwesomeIcon icon={faLock} />
        </div>
        <p className="mt-6 text-xs font-black uppercase tracking-[0.18em] text-primary">Private library</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight">Access denied</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted">
          Your IP address is not authorised to access this media server. Contact the administrator to request access.
        </p>
      </section>
    </main>
  );
}
