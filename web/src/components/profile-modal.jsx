import { useEffect, useState, useCallback } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleUser } from "@fortawesome/free-solid-svg-icons/faCircleUser";
import { faRightFromBracket } from "@fortawesome/free-solid-svg-icons/faRightFromBracket";
import { faXmark } from "@fortawesome/free-solid-svg-icons/faXmark";
import { faCheck } from "@fortawesome/free-solid-svg-icons/faCheck";
import { faChevronDown } from "@fortawesome/free-solid-svg-icons/faChevronDown";
import { faRotateRight } from "@fortawesome/free-solid-svg-icons/faRotateRight";
import { api, profilePictureUrl } from "../api";
import { APP_VERSION_LABEL } from "../version";
import { SpotifyEqualizer } from "./global-player/spotify-equalizer";
import {
  EQ_BANDS,
  GAIN_MIN,
  GAIN_MAX,
  EQ_PRESETS,
  readStoredGains,
  readStoredEnabled,
  readStoredTargetDb,
  detectPreset,
  dispatchEqUpdate,
  calculateTargetShift,
} from "./global-player/use-equalizer";

export function ProfileModal({ isOpen, onClose, access }) {
  const currentUsername = access?.username || "";
  const currentAvatar = access?.profile_picture || access?.user?.profile_picture || "fine";
  const userEqSettings = access?.user?.eq_settings || access?.eq_settings;
  const tier = access?.tier ?? 0;
  const [username, setUsername] = useState(currentUsername);
  const [avatar, setAvatar] = useState(currentAvatar);
  const [availableAvatars, setAvailableAvatars] = useState([]);
  const [avatarsOpen, setAvatarsOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [eqOpen, setEqOpen] = useState(false);
  const [eqEnabled, setEqEnabled] = useState(() => {
    if (typeof userEqSettings?.enabled === "boolean") return userEqSettings.enabled;
    return readStoredEnabled();
  });
  const [eqGains, setEqGains] = useState(() => {
    if (Array.isArray(userEqSettings?.gains) && userEqSettings.gains.length === 10) return userEqSettings.gains.slice();
    return readStoredGains() ?? EQ_PRESETS.flat.gains.slice();
  });
  const [eqTargetDb, setEqTargetDb] = useState(() => {
    if (typeof userEqSettings?.targetDb === "number") return userEqSettings.targetDb;
    return readStoredTargetDb();
  });
  const [eqDirty, setEqDirty] = useState(false);
  const [creditsText, setCreditsText] = useState("");
  const [showCreditsRaw, setShowCreditsRaw] = useState(false);
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (isOpen) {
      setUsername(currentUsername);
      setAvatar(currentAvatar);
      setPassword("");
      setCurrentPassword("");
      setError("");
      setSuccess("");
      setAvatarsOpen(false);
      setPasswordOpen(false);
      setEqOpen(false);
      setEqDirty(false);
      setShowCreditsRaw(false);
      setClearingCache(false);
      if (userEqSettings) {
        if (typeof userEqSettings.enabled === "boolean") setEqEnabled(userEqSettings.enabled);
        if (Array.isArray(userEqSettings.gains) && userEqSettings.gains.length === 10) setEqGains(userEqSettings.gains.slice());
        if (typeof userEqSettings.targetDb === "number") setEqTargetDb(userEqSettings.targetDb);
      }
    }
  }, [isOpen, currentUsername, currentAvatar, userEqSettings]);

  const handleSetEqGain = useCallback((idx, val) => {
    const clamped = Math.min(GAIN_MAX, Math.max(GAIN_MIN, Number(val)));
    setEqGains((prev) => {
      const next = prev.slice();
      next[idx] = clamped;
      try { window.localStorage.setItem("pfs:eq-gains", JSON.stringify(next)); } catch {}
      dispatchEqUpdate({ gains: next });
      return next;
    });
    setEqDirty(true);
  }, []);

  const handleSetEqGains = useCallback((nextGains) => {
    if (!Array.isArray(nextGains)) return;
    const clamped = nextGains.map((g) => Math.min(GAIN_MAX, Math.max(GAIN_MIN, Number(g) || 0)));
    setEqGains(clamped);
    try { window.localStorage.setItem("pfs:eq-gains", JSON.stringify(clamped)); } catch {}
    dispatchEqUpdate({ gains: clamped });
    setEqDirty(true);
  }, []);

  const handleSetEqPreset = useCallback((key) => {
    const preset = EQ_PRESETS[key];
    if (!preset) return;
    const next = preset.gains.slice();
    setEqGains(next);
    try { window.localStorage.setItem("pfs:eq-gains", JSON.stringify(next)); } catch {}
    dispatchEqUpdate({ gains: next, preset: key });
    setEqDirty(true);
  }, []);

  const handleSetEqEnabled = useCallback((enabled) => {
    setEqEnabled(enabled);
    try { window.localStorage.setItem("pfs:eq-enabled", String(enabled)); } catch {}
    dispatchEqUpdate({ enabled });
    setEqDirty(true);
  }, []);

  const handleSetEqTargetDb = useCallback((db) => {
    const clamped = Math.min(GAIN_MAX, Math.max(GAIN_MIN, Math.round(Number(db) * 2) / 2));
    setEqTargetDb(clamped);
    try { window.localStorage.setItem("pfs:eq-target-db", String(clamped)); } catch {}
    dispatchEqUpdate({ targetDb: clamped });
    setEqDirty(true);
  }, []);

  const handleAdjustEqToTarget = useCallback((target) => {
    const db = target !== undefined ? Number(target) : eqTargetDb;
    const clamped = Math.min(GAIN_MAX, Math.max(GAIN_MIN, Math.round(db * 2) / 2));
    const next = calculateTargetShift(eqGains, clamped, GAIN_MIN, GAIN_MAX);
    setEqGains(next);
    try { window.localStorage.setItem("pfs:eq-gains", JSON.stringify(next)); } catch {}
    if (!eqEnabled) {
      setEqEnabled(true);
      try { window.localStorage.setItem("pfs:eq-enabled", "true"); } catch {}
      dispatchEqUpdate({ gains: next, enabled: true });
    } else {
      dispatchEqUpdate({ gains: next });
    }
    setEqDirty(true);
    return next;
  }, [eqGains, eqTargetDb, eqEnabled]);

  const handleClearCache = async () => {
    if (clearingCache) return;
    setClearingCache(true);
    try {
      if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) await reg.unregister();
      }
      if (typeof window !== "undefined" && "caches" in window) {
        const keys = await caches.keys();
        for (const key of keys) await caches.delete(key);
      }
    } finally {
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    api("/api/profile-pictures")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (Array.isArray(data?.pictures)) {
          setAvailableAvatars(data.pictures);
        }
      })
      .catch(() => {});

    api("/api/profile-pictures/credits")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.credits) {
          setCreditsText(data.credits);
        }
      })
      .catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !submitting) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, submitting, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    const hasNewUsername = username.trim() !== currentUsername;
    const hasNewPassword = password.length > 0;
    const hasNewAvatar = avatar !== currentAvatar;
    const hasNewEq = eqDirty;

    if (!hasNewUsername && !hasNewPassword && !hasNewAvatar && !hasNewEq) {
      setError("No changes requested.");
      return;
    }

    if (hasNewPassword && password.length < 12) {
      setError("New password must be at least 12 characters.");
      return;
    }

    if (hasNewPassword && !currentPassword) {
      setError("Enter your current password to verify this change.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        username: username.trim(),
      };
      if (hasNewAvatar) {
        payload.profile_picture = avatar;
      }
      if (hasNewPassword) {
        payload.password = password;
        payload.currentPassword = currentPassword;
      } else if (currentPassword) {
        payload.currentPassword = currentPassword;
      }
      if (hasNewEq) {
        payload.eq_settings = {
          enabled: eqEnabled,
          preset: detectPreset(eqGains),
          gains: eqGains,
          targetDb: eqTargetDb,
        };
      }

      const response = await api("/api/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || "Failed to update profile.");
      }

      if (data?.user) {
        access?.updateUser?.(data.user);
      }

      setSuccess("Profile updated successfully!");
      setEqDirty(false);
      setPassword("");
      setCurrentPassword("");
    } catch (err) {
      setError(err.message || "Failed to update profile.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = () => {
    onClose();
    access?.logout?.();
  };

  const activeAvatarName = availableAvatars.find((p) => p.id === avatar)?.name || avatar;

  return (
    <div
      className="profile-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="profile-modal">
        <div className="profile-modal-header">
          <h2 id="profile-modal-title" className="profile-modal-title">
            Profile
          </h2>
          <button
            type="button"
            className="profile-modal-close"
            aria-label="Close profile"
            disabled={submitting}
            onClick={onClose}
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div className="profile-modal-body">
          <div className="profile-modal-user-card">
            <span className="profile-modal-user-avatar">
              <img
                src={profilePictureUrl(avatar, "l")}
                alt={currentUsername}
                className="profile-modal-avatar-preview-img"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                  if (e.currentTarget.nextSibling) e.currentTarget.nextSibling.style.display = "flex";
                }}
              />
              <FontAwesomeIcon icon={faCircleUser} style={{ display: "none" }} />
            </span>
            <div className="profile-modal-user-details">
              <strong>{currentUsername || "User"}</strong>
              <span className="profile-modal-role-pill">
                {tier >= 100 ? "Administrator" : "Standard User"}
              </span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="profile-modal-form">
            <div className="profile-modal-field">
              <label htmlFor="profile-username" className="profile-modal-label">
                Username
              </label>
              <input
                id="profile-username"
                type="text"
                className="profile-modal-input"
                autoComplete="username"
                required
                minLength={3}
                maxLength={40}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={submitting}
              />
              <small className="profile-modal-help">
                3–40 characters (letters, numbers, dots, underscores, hyphens).
              </small>
            </div>

            {/* Collapsible: Profile Picture & Credits */}
            <div className="profile-modal-collapsible">
              <button
                type="button"
                className="profile-modal-collapsible-trigger"
                aria-expanded={avatarsOpen}
                onClick={() => setAvatarsOpen((prev) => !prev)}
              >
                <span className="profile-modal-collapsible-title">
                  <strong>Profile Picture &amp; Credits</strong>
                  <small className="profile-modal-collapsible-subtitle">
                    Active: {activeAvatarName}
                  </small>
                </span>
                <FontAwesomeIcon
                  icon={faChevronDown}
                  className={`profile-modal-chevron${avatarsOpen ? " profile-modal-chevron--open" : ""}`}
                />
              </button>

              {avatarsOpen && (
                <div className="profile-modal-collapsible-content">
                  <div
                    className="profile-modal-avatar-picker"
                    role="radiogroup"
                    aria-label="Choose profile picture"
                  >
                    {availableAvatars.map((pic) => {
                      const isSelected = pic.id === avatar;
                      return (
                        <button
                          key={pic.id}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          title={pic.name}
                          className={`profile-modal-avatar-choice${isSelected ? " profile-modal-avatar-choice--selected" : ""}`}
                          onClick={() => setAvatar(pic.id)}
                          disabled={submitting}
                        >
                          <img
                            src={profilePictureUrl(pic.id, "s")}
                            alt={pic.name}
                            loading="lazy"
                          />
                        </button>
                      );
                    })}
                  </div>

                  {/* Credits Section */}
                  <div className="profile-modal-credits">
                    <div className="profile-modal-credits-header">
                      <strong>Expedition 33 Emotes Credits</strong>
                      {creditsText && (
                        <button
                          type="button"
                          className="profile-modal-credits-toggle"
                          onClick={() => setShowCreditsRaw((v) => !v)}
                        >
                          {showCreditsRaw ? "Hide CREDITS.txt" : "View CREDITS.txt"}
                        </button>
                      )}
                    </div>
                    <p className="profile-modal-credits-desc">
                      Official community emotes by talented artists:
                    </p>
                    <ul className="profile-modal-credits-list">
                      <li>
                        <a
                          href="https://x.com/comickergirl"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          comickergirl (Sarah Leuver)
                        </a>
                      </li>
                      <li>
                        <a
                          href="https://x.com/bugyakis"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Bugyakis
                        </a>
                      </li>
                      <li>
                        <a
                          href="https://x.com/IrunoArt"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          IrunoArt
                        </a>
                      </li>
                    </ul>
                    {showCreditsRaw && creditsText && (
                      <pre className="profile-modal-credits-raw">{creditsText}</pre>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Collapsible: Change Password */}
            <div className="profile-modal-collapsible">
              <button
                type="button"
                className="profile-modal-collapsible-trigger"
                aria-expanded={passwordOpen}
                onClick={() => setPasswordOpen((prev) => !prev)}
              >
                <span className="profile-modal-collapsible-title">
                  <strong>Change Password</strong>
                  <small className="profile-modal-collapsible-subtitle">
                    {password ? "New password entered" : "Leave blank to keep current password"}
                  </small>
                </span>
                <FontAwesomeIcon
                  icon={faChevronDown}
                  className={`profile-modal-chevron${passwordOpen ? " profile-modal-chevron--open" : ""}`}
                />
              </button>

              {(passwordOpen || password.length > 0) && (
                <div className="profile-modal-collapsible-content">
                  <div className="profile-modal-field">
                    <label htmlFor="profile-password" className="profile-modal-label">
                      New Password
                    </label>
                    <input
                      id="profile-password"
                      type="password"
                      className="profile-modal-input"
                      autoComplete="new-password"
                      placeholder="Enter new password"
                      minLength={12}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={submitting}
                    />
                    <small className="profile-modal-help">
                      Minimum 12 characters if updating password.
                    </small>
                  </div>

                  <div className="profile-modal-field">
                    <label htmlFor="profile-current-password" className="profile-modal-label">
                      Current Password
                    </label>
                    <input
                      id="profile-current-password"
                      type="password"
                      className="profile-modal-input"
                      autoComplete="current-password"
                      placeholder="Required to confirm password change"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      disabled={submitting}
                    />
                    <small className="profile-modal-help">
                      Required when changing password.
                    </small>
                  </div>
                </div>
              )}
            </div>

            {/* Collapsible: Audio Equalizer (EQ) */}
            <div className="profile-modal-collapsible">
              <button
                type="button"
                className="profile-modal-collapsible-trigger"
                aria-expanded={eqOpen}
                onClick={() => setEqOpen((prev) => !prev)}
              >
                <span className="profile-modal-collapsible-title">
                  <strong>Audio Equalizer (EQ)</strong>
                  <small className="profile-modal-collapsible-subtitle">
                    {eqEnabled ? `Active • ${EQ_PRESETS[detectPreset(eqGains)]?.label || "Custom"}` : "Disabled"}
                  </small>
                </span>
                <FontAwesomeIcon
                  icon={faChevronDown}
                  className={`profile-modal-chevron${eqOpen ? " profile-modal-chevron--open" : ""}`}
                />
              </button>

              {eqOpen && (
                <div className="profile-modal-collapsible-content profile-modal-eq-content">
                  <SpotifyEqualizer
                    gains={eqGains}
                    eqBands={EQ_BANDS}
                    preset={detectPreset(eqGains)}
                    eqEnabled={eqEnabled}
                    gainMin={GAIN_MIN}
                    gainMax={GAIN_MAX}
                    targetDb={eqTargetDb}
                    onSetGain={handleSetEqGain}
                    onSetGains={handleSetEqGains}
                    onSetPreset={handleSetEqPreset}
                    onSetEnabled={handleSetEqEnabled}
                    onSetTargetDb={handleSetEqTargetDb}
                    onAdjustToTarget={handleAdjustEqToTarget}
                  />
                </div>
              )}
            </div>

            {error && (
              <div role="alert" className="profile-modal-alert profile-modal-alert-error">
                {error}
              </div>
            )}

            {success && (
              <div role="status" className="profile-modal-alert profile-modal-alert-success">
                <FontAwesomeIcon icon={faCheck} /> {success}
              </div>
            )}

            <div className="profile-modal-actions">
              <button
                type="submit"
                disabled={submitting}
                className="profile-modal-btn profile-modal-btn-primary"
              >
                {submitting ? "Updating…" : "Update user"}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={onClose}
                className="profile-modal-btn profile-modal-btn-secondary"
              >
                Batal
              </button>
            </div>
          </form>

          <div className="profile-modal-divider" />

          <div className="profile-modal-utility-section">
            <span className="profile-modal-app-version">Dogmedia Web {APP_VERSION_LABEL}</span>
            <button
              type="button"
              className="profile-modal-clear-cache-btn"
              title="Clear cached app data and reload"
              onClick={handleClearCache}
              disabled={submitting || clearingCache}
            >
              <FontAwesomeIcon icon={faRotateRight} spin={clearingCache} />
              <span>{clearingCache ? "Clearing…" : "Clear cache"}</span>
            </button>
          </div>

          <div className="profile-modal-divider" />

          <div className="profile-modal-logout-section">
            <button
              type="button"
              className="profile-modal-logout-btn"
              onClick={handleLogout}
              disabled={submitting || clearingCache}
            >
              <FontAwesomeIcon icon={faRightFromBracket} />
              <span>Log out</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProfileModal;
