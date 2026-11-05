import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEllipsis } from "@fortawesome/free-solid-svg-icons/faEllipsis";
import { Navigate } from "react-router-dom";
import { useAccess } from "../access-context";
import { api } from "../api";
import { ConfirmationDialog } from "../components/confirmation-dialog";
import "./master.css";

export default function MasterUsers() {
  const access = useAccess();
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [resetResult, setResetResult] = useState(null);
  const [openActionsId, setOpenActionsId] = useState(null);
  const [confirmation, setConfirmation] = useState(null);

  useEffect(() => {
    if (access.tier < 100) return undefined;
    let active = true;
    api("/api/master/users")
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || "Could not load users");
        return data;
      })
      .then((data) => { if (active) setUsers(data); })
      .catch((error) => { if (active) setMessage({ type: "error", text: error.message }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [access.tier]);

  useEffect(() => {
    if (openActionsId === null) return undefined;
    const closeOutside = (event) => {
      if (!document.getElementById(`master-user-actions-${openActionsId}`)?.contains(event.target)) setOpenActionsId(null);
    };
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      setOpenActionsId(null);
      document.getElementById(`master-user-trigger-${openActionsId}`)?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openActionsId]);

  const visibleUsers = useMemo(() => users.filter((user) => user.username.toLowerCase().includes(query.toLowerCase())), [users, query]);
  const adminCount = useMemo(() => users.filter((user) => Number(user.access_tier) >= 100).length, [users]);
  if (access.tier < 100) return <Navigate to="/" replace />;

  const changeTier = async (user, tier) => {
    setOpenActionsId(null);
    if (tier === user.access_tier) return;
    setSavingId(user.id);
    setMessage(null);
    try {
      const response = await api(`/api/master/users/${user.id}/tier`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not update user");
      setUsers((current) => current.map((item) => item.id === user.id ? data : item));
      setMessage({ type: "success", text: `${user.username} is now ${tier === 100 ? "an admin" : "a standard user"}.` });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setSavingId(null);
    }
  };

  const resetPassword = async (user) => {
    setSavingId(user.id);
    setResetResult(null);
    setMessage(null);
    try {
      const response = await api(`/api/master/users/${user.id}/reset-password`, { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not reset password");
      setResetResult({ username: data.username, password: data.temporaryPassword });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setSavingId(null);
    }
  };

  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(resetResult.password);
      setMessage({ type: "success", text: "Temporary password copied." });
    } catch {
      setMessage({ type: "error", text: "Could not copy. Select the password and copy it manually." });
    }
  };

  return <main className="master-page">
    <header className="master-page-header"><p>Master</p><h1>Users</h1><span>View accounts and manage access.</span></header>
    {message && <p className={`master-notice master-notice--${message.type}`} role={message.type === "error" ? "alert" : "status"}>{message.text}</p>}
    {resetResult && <section className="master-reset-result" role="status" aria-label="Temporary password">
      <div><strong>Password reset for {resetResult.username}</strong><p>Previous sessions have ended. Give this temporary password to the user and ask them to change it in Profile. It is shown here only once.</p><code>{resetResult.password}</code></div>
      <div className="master-reset-result-actions"><button type="button" onClick={copyPassword}>Copy password</button><button type="button" onClick={() => setResetResult(null)}>Close</button></div>
    </section>}
    <section className="master-card master-card--users">
      <div className="master-card-head"><div><h2>Accounts</h2><p>{users.length} registered users</p></div><label className="master-search">Search users<input value={query} onChange={(event) => { setQuery(event.target.value); setOpenActionsId(null); }} placeholder="Username" /></label></div>
      {loading ? <p className="master-empty">Loading users…</p> : visibleUsers.length === 0 ? <p className="master-empty">No users found.</p> : <div className="master-list">
        {visibleUsers.map((user) => <div className={`master-list-row${openActionsId === user.id ? " master-list-row--actions-open" : ""}`} key={user.id}>
          <div><strong>{user.username}</strong><small>Joined {new Date(user.created_at).toLocaleDateString()} · {Number(user.access_tier) >= 999 ? "Administrator" : Number(user.access_tier) >= 100 ? "Admin" : "Standard user"}</small></div>
          {Number(user.id) !== Number(access.id) && Number(user.access_tier) < Number(access.tier) ? <div className="master-user-actions" id={`master-user-actions-${user.id}`}>
            <button type="button" id={`master-user-trigger-${user.id}`} className="master-user-actions-trigger" aria-label={`Actions for ${user.username}`} aria-expanded={openActionsId === user.id} onClick={() => setOpenActionsId((current) => current === user.id ? null : user.id)}><FontAwesomeIcon icon={faEllipsis} /></button>
            {openActionsId === user.id && <div className="master-user-menu" id={`master-user-menu-${user.id}`} role="group" aria-label={`Actions for ${user.username}`}>
              {access.tier >= 999 && Number(user.access_tier) < 999 && <label className="master-tier-control">Access<select aria-label={`Access for ${user.username}`} value={user.access_tier} disabled={savingId === user.id} onChange={(event) => { const nextTier = Number(event.target.value); if (nextTier === Number(user.access_tier)) return; setOpenActionsId(null); setConfirmation({ kind: "tier", user, nextTier, title: `${nextTier === 0 ? "Downgrade" : "Grant admin access to"} ${user.username}?`, description: nextTier === 0 ? `${user.username} will become a standard user and lose admin access.` : `${user.username} will gain admin access to the library.`, impact: `Current sessions for ${user.username} will end. They must sign in again to use the new role.`, confirmLabel: nextTier === 0 ? "Downgrade role" : "Grant admin access", tone: nextTier === 0 ? "danger" : undefined, returnFocusId: `master-user-trigger-${user.id}` }); }}><option value={0} disabled={Number(user.access_tier) >= 100 && adminCount <= 1}>Standard user</option><option value={100}>Admin</option>{![0, 100].includes(Number(user.access_tier)) && <option value={user.access_tier}>Tier {user.access_tier}</option>}</select>{Number(user.access_tier) >= 100 && adminCount <= 1 && <span className="master-tier-note">At least one admin must remain.</span>}</label>}
              <button type="button" className="master-reset-button" disabled={savingId === user.id} onClick={() => { setOpenActionsId(null); setConfirmation({ kind: "reset", user, title: `Reset password for ${user.username}?`, description: `A new random password will replace ${user.username}'s current password.`, impact: `All active sessions for ${user.username} will end. The new password appears once after reset so you can give it to the user.`, confirmLabel: "Reset password", tone: "danger", returnFocusId: `master-user-trigger-${user.id}` }); }}>{savingId === user.id ? "Resetting…" : "Reset password"}</button>
            </div>}
          </div> : <span className="master-badge">Tier {user.access_tier}</span>}
        </div>)}
      </div>}
    </section>
    <ConfirmationDialog confirmation={confirmation} onCancel={() => setConfirmation(null)} onConfirm={() => { const action = confirmation; setConfirmation(null); if (action?.kind === "tier") void changeTier(action.user, action.nextTier); else if (action?.kind === "reset") void resetPassword(action.user); }} />
  </main>;
}
