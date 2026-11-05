import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAccess } from "../access-context";
import { api } from "../api";
import MobileReleaseManager, { uploadAndroidRelease } from "../components/admin/MobileReleaseManager";
import { ConfirmationDialog } from "../components/confirmation-dialog";
import { APP_VERSION } from "../version";
import "./admin-media-import.css";
import "./master.css";

export default function AndroidUpload() {
  const { tier } = useAccess();
  const [release, setRelease] = useState(null);
  const [version, setVersion] = useState(APP_VERSION);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [message, setMessage] = useState(null);
  const [confirmation, setConfirmation] = useState(null);

  useEffect(() => {
    if (tier < 100) return undefined;
    let active = true;
    api("/api/mobile-release")
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load Android release");
        return response.json();
      })
      .then((value) => {
        if (!active) return;
        setRelease(value);
        if (value.available && value.version) setVersion(value.version);
      })
      .catch((error) => { if (active) setMessage({ type: "error", text: error.message }); });
    return () => { active = false; };
  }, [tier]);

  if (tier < 100) return <Navigate to="/" replace />;

  const handleUpload = async (event) => {
    event.preventDefault();
    if (!file || !version.trim()) return;
    setUploading(true);
    setProgress(0);
    setMessage(null);
    try {
      const next = await uploadAndroidRelease({ file, version: version.trim(), onProgress: setProgress });
      setRelease(next);
      setFile(null);
      const input = document.getElementById("admin-android-release-file");
      if (input) input.value = "";
      setMessage({ type: "success", text: `Android ${next.version} is ready to download.` });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setUploading(false);
      setProgress(null);
    }
  };

  const removeRelease = async () => {
    try {
      const response = await api("/api/mobile-release", { method: "DELETE" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Release removal failed");
      setRelease({ available: false });
      setMessage({ type: "success", text: "Android release removed." });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  };

  return <main className="master-page">
    <header className="master-page-header"><p>Distribution</p><h1>Upload Android</h1><span>Publish the APK offered to web visitors.</span></header>
    {message && <p className={`master-notice master-notice--${message.type}`} role={message.type === "error" ? "alert" : "status"}>{message.text}</p>}
    <MobileReleaseManager
      mobileRelease={release}
      onDelete={() => setConfirmation({ title: "Remove Android release?", description: `Dogmedia ${release?.version || "the current Android release"} will no longer be available for download.`, impact: "The Android download link will stop working until another APK is published.", confirmLabel: "Remove release", tone: "danger" })}
      onFileChange={setFile}
      onSubmit={handleUpload}
      onVersionChange={setVersion}
      releaseFile={file}
      releaseProgress={progress}
      releaseVersion={version}
      styles={{ spinner: { width: 14, height: 14, border: "2px solid currentColor", borderRadius: "50%" } }}
      uploading={uploading}
    />
    <ConfirmationDialog confirmation={confirmation} onCancel={() => setConfirmation(null)} onConfirm={() => { setConfirmation(null); void removeRelease(); }} />
  </main>;
}
