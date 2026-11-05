import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAccess } from "../access-context";
import { api } from "../api";
import "./master.css";

const STATUS_LABELS = { pending: "Pending", added: "Added to media", rejected: "Declined" };

export default function RequestMedia() {
  const access = useAccess();
  const admin = access.tier >= 100;
  const [requests, setRequests] = useState([]);
  const [title, setTitle] = useState("");
  const [mediaType, setMediaType] = useState("music");
  const [details, setDetails] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let active = true;
    api("/api/media-requests")
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || "Could not load requests");
        return data;
      })
      .then((data) => { if (active) setRequests(data); })
      .catch((error) => { if (active) setMessage({ type: "error", text: error.message }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const response = await api("/api/media-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title.trim(), mediaType, details: details.trim() }) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not send request");
      setRequests((current) => [data, ...current]);
      setTitle("");
      setDetails("");
      setMessage({ type: "success", text: "Request sent. An admin can review it here." });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (item, status) => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await api(`/api/media-requests/${item.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not update request");
      setRequests((current) => current.map((row) => row.id === item.id ? { ...row, ...data } : row));
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setSaving(false);
    }
  };

  return <main className="master-page">
    <header className="master-page-header"><p>{admin ? "Master" : "Library"}</p><h1>Request Media</h1><span>{admin ? "Review requests and add the requested items through Medias." : "Tell the admins what you would like to see in the library."}</span></header>
    {message && <p className={`master-notice master-notice--${message.type}`} role={message.type === "error" ? "alert" : "status"}>{message.text}</p>}
    <section className="master-card">
      <div className="master-card-head"><div><h2>New request</h2><p>Include enough detail to help an admin find the right media.</p></div></div>
      <form className="master-form" onSubmit={submit}>
        <label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} placeholder="Song, album, film, series, or photo title" /></label>
        <label>Type<select value={mediaType} onChange={(event) => setMediaType(event.target.value)}><option value="music">Music</option><option value="video">Video</option><option value="photo">Photo</option></select></label>
        <label className="master-form-wide">Details (optional)<textarea value={details} onChange={(event) => setDetails(event.target.value)} maxLength={2000} rows={3} placeholder="Artist, year, episode, or a helpful link" /></label>
        <button type="submit" disabled={saving || !title.trim()}>Send request</button>
      </form>
    </section>
    <section className="master-card">
      <div className="master-card-head"><div><h2>{admin ? "All requests" : "My requests"}</h2><p>{requests.length} requests</p></div></div>
      {loading ? <p className="master-empty">Loading requests…</p> : requests.length === 0 ? <p className="master-empty">No requests yet.</p> : <div className="master-list">
        {requests.map((item) => <div className="master-list-row master-request-row" key={item.id}>
          <div><div className="master-request-title"><strong>{item.title}</strong><span className={`master-badge master-badge--${item.status}`}>{STATUS_LABELS[item.status] || item.status}</span></div><small>{item.media_type} · {admin ? `${item.username} · ` : ""}{new Date(item.created_at).toLocaleString()}</small>{item.details && <p>{item.details}</p>}</div>
          {admin && <div className="master-request-actions"><Link to={`/admin/media?request=${encodeURIComponent(item.id)}`}>Add in Medias</Link><select aria-label={`Status for ${item.title}`} value={item.status} disabled={saving} onChange={(event) => changeStatus(item, event.target.value)}><option value="pending">Pending</option><option value="added">Added</option><option value="rejected">Declined</option></select></div>}
        </div>)}
      </div>}
    </section>
  </main>;
}
