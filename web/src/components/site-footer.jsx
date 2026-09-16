import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowUpRightFromSquare,
  faChevronDown,
  faCodeBranch,
  faDesktop,
  faGlobe,
  faMobileScreen,
  faServer,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { apiUrl } from "../api";
import "./site-footer.css";

const ANDROID_APK_URL = import.meta.env.VITE_ANDROID_APK_URL || apiUrl("/api/mobile-release/download");
const GITHUB_REPO_URL = "https://github.com/Doglexable/DogMedia";

const MODAL_DATA = {
  privacy: {
    title: "Privacy & Ownership",
    subtitle: "Local-First Architecture",
    body: `DogMedia is designed from the ground up for personal data sovereignty and complete privacy.

• Zero Telemetry: No behavioral logging, fingerprinting, or tracking scripts.
• Local Storage: Media files, listening habits, and metadata stay strictly inside your storage volume.
• Direct Streaming: Media chunks are served directly via HTTP Range requests without intermediary cloud proxies.
• Private By Design: You own your collection, your stories, and your rhythm.`,
  },
  terms: {
    title: "Terms of Use",
    subtitle: "Personal Media Space",
    body: `DogMedia is an independent, personal media library system intended for lawful self-hosted media playback.

• Personal Collection: For organizing and playing audio, video, and photos you lawfully own or have rights to stream.
• Self-Hosted Responsibility: You maintain server access controls, network whitelist rules, and data preservation.
• Free & Independent: Provided as open software for independent media enthusiasts.`,
  },
  license: {
    title: "Open Source License",
    subtitle: "MIT License",
    body: `DogMedia is free and open source software licensed under the MIT License.

Copyright (c) 2026 DogMedia contributors.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files, to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software.`,
  },
  protocol: {
    title: "Direct Streaming Protocol",
    subtitle: "Native HTTP Range Chunking",
    body: `DogMedia implements native high-performance media chunk streaming:

• HTTP 206 Partial Content: Instant timeline scrubbing and precise video seeking.
• Zero Transcode Latency: Original audio and video bitstreams are preserved without destructive compression.
• Redis Queue Sync: Atomic queue manipulation and persistent resume bookmarks across all your devices.`,
  },
  "desktop-lan": {
    title: "Desktop & LAN Streaming",
    subtitle: "Home Network Playback",
    body: `Access your personal media library anywhere on your home network:

• Cross-Device: Stream to any laptop, desktop, tablet, or Smart TV browser via your server's local IP address.
• Progressive Web App: Install directly from your browser as a standalone desktop application.
• Seamless Continuity: Playback positions and resume states sync seamlessly across your devices.`,
  },
  "self-hosted": {
    title: "Self-Hosted Architecture",
    subtitle: "Independent Technology Stack",
    body: `Built for reliability, speed, and long-term ownership:

• Backend: FastifyJS (Node.js 22 on Alpine Linux)
• Database: PostgreSQL 17 with automated migration pipelines
• Cache & Queues: Redis 7 for high-speed queue operations and active playback state
• Frontend: React 19, Vite, and native CSS variables
• Deployment: Podman & Docker Compose rootless containerization`,
  },
};

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.893.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

function TwitterXIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function InfoModal({ infoKey, onClose }) {
  const data = MODAL_DATA[infoKey];
  const titleId = useId();

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!data) return null;

  return (
    <div
      className="site-footer-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
    >
      <div
        className="site-footer-modal-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="site-footer-modal-header">
          <div>
            <h2 id={titleId} className="site-footer-modal-title">
              {data.title}
            </h2>
            <p className="site-footer-modal-subtitle">{data.subtitle}</p>
          </div>
          <button
            type="button"
            className="site-footer-modal-close"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
        <div className="site-footer-modal-body">{data.body}</div>
      </div>
    </div>
  );
}

export function SiteFooter({ access }) {
  const currentYear = new Date().getFullYear();
  const [activeModal, setActiveModal] = useState(null);
  const [openSections, setOpenSections] = useState({
    product: true,
    platform: false,
    resources: false,
    legal: false,
  });

  const isTierAdmin = Number(access?.tier || 0) >= 100;

  const toggleSection = (key) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleOpenModal = (event, key) => {
    event.preventDefault();
    setActiveModal(key);
  };

  return (
    <footer className="site-editorial-footer" role="contentinfo" aria-label="Site footer">
      <div className="site-footer-container">
        {/* ── 1. Main Multi-Column Sitemap ── */}
        <nav className="site-footer-sitemap" aria-label="Footer sitemap">
          {/* Brand Column */}
          <div className="site-footer-brand-col">
            <Link to="/" className="site-footer-brand-header">
              <img
                src="/web-app-manifest-192x192.png"
                alt="DogMedia"
                className="site-footer-brand-logo"
                width="38"
                height="38"
              />
              <span className="site-footer-brand-title">DogMedia</span>
            </Link>

            <p className="site-footer-brand-tagline">
              “Koleksimu, ceritamu, ritmemu sendiri.”
            </p>

            <p className="site-footer-brand-desc">
              Your media. Your space. Your story. Your rhythm. A personal sanctuary for owning, streaming, and rediscovering your private audio and video vault.
            </p>

            <div className="site-footer-ethos-tags" aria-label="Core principles">
              <span className="site-footer-tag">Personal Collection</span>
              <span className="site-footer-tag">Zero Telemetry</span>
              <span className="site-footer-tag">Direct Stream</span>
            </div>
          </div>

          {/* Product Column */}
          <div className="site-footer-nav-col">
            <button
              type="button"
              className="site-footer-col-header"
              onClick={() => toggleSection("product")}
              aria-expanded={openSections.product}
            >
              <h3 className="site-footer-col-title">Product</h3>
              <FontAwesomeIcon
                icon={faChevronDown}
                className={`site-footer-col-toggle-icon${openSections.product ? " site-footer-col-toggle-icon--open" : ""}`}
                aria-hidden="true"
              />
            </button>
            <ul className={`site-footer-nav-list${openSections.product ? " site-footer-nav-list--open" : ""}`}>
              <li>
                <Link to="/" className="site-footer-link">
                  Library
                </Link>
              </li>
              <li>
                <Link to="/?view=liked" className="site-footer-link">
                  Favorites
                </Link>
              </li>
              <li>
                <Link to="/wrapped" className="site-footer-link">
                  Wrapped Recap
                </Link>
              </li>
              <li>
                <a
                  href={ANDROID_APK_URL}
                  download="dogmedia-android.apk"
                  className="site-footer-link"
                  title="Download DogMedia Android APK"
                >
                  Android App
                </a>
              </li>
              {isTierAdmin && (
                <li>
                  <Link to="/admin" className="site-footer-link">
                    Admin Console
                  </Link>
                </li>
              )}
            </ul>
          </div>

          {/* Platform Column */}
          <div className="site-footer-nav-col">
            <button
              type="button"
              className="site-footer-col-header"
              onClick={() => toggleSection("platform")}
              aria-expanded={openSections.platform}
            >
              <h3 className="site-footer-col-title">Platform</h3>
              <FontAwesomeIcon
                icon={faChevronDown}
                className={`site-footer-col-toggle-icon${openSections.platform ? " site-footer-col-toggle-icon--open" : ""}`}
                aria-hidden="true"
              />
            </button>
            <ul className={`site-footer-nav-list${openSections.platform ? " site-footer-nav-list--open" : ""}`}>
              <li>
                <Link to="/" className="site-footer-link">
                  Web Player
                </Link>
              </li>
              <li>
                <a
                  href={ANDROID_APK_URL}
                  className="site-footer-link"
                  title="Download Android APK"
                >
                  Mobile APK
                </a>
              </li>
              <li>
                <button
                  type="button"
                  className="site-footer-link"
                  onClick={(event) => handleOpenModal(event, "desktop-lan")}
                >
                  Desktop & LAN
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="site-footer-link"
                  onClick={(event) => handleOpenModal(event, "self-hosted")}
                >
                  Self-Hosted Vault
                </button>
              </li>
            </ul>
          </div>

          {/* Resources Column */}
          <div className="site-footer-nav-col">
            <button
              type="button"
              className="site-footer-col-header"
              onClick={() => toggleSection("resources")}
              aria-expanded={openSections.resources}
            >
              <h3 className="site-footer-col-title">Resources</h3>
              <FontAwesomeIcon
                icon={faChevronDown}
                className={`site-footer-col-toggle-icon${openSections.resources ? " site-footer-col-toggle-icon--open" : ""}`}
                aria-hidden="true"
              />
            </button>
            <ul className={`site-footer-nav-list${openSections.resources ? " site-footer-nav-list--open" : ""}`}>
              <li>
                <a
                  href={`${GITHUB_REPO_URL}#readme`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="site-footer-link"
                >
                  Documentation
                  <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="site-footer-ext-icon" aria-hidden="true" />
                </a>
              </li>
              <li>
                <a
                  href={`${GITHUB_REPO_URL}/releases`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="site-footer-link"
                >
                  Changelog
                  <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="site-footer-ext-icon" aria-hidden="true" />
                </a>
              </li>
              <li>
                <a
                  href={GITHUB_REPO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="site-footer-link"
                >
                  Source Code
                  <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="site-footer-ext-icon" aria-hidden="true" />
                </a>
              </li>
              <li>
                <a
                  href={`${GITHUB_REPO_URL}/issues`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="site-footer-link"
                >
                  Community & Issues
                  <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="site-footer-ext-icon" aria-hidden="true" />
                </a>
              </li>
            </ul>
          </div>

          {/* Legal Column */}
          <div className="site-footer-nav-col">
            <button
              type="button"
              className="site-footer-col-header"
              onClick={() => toggleSection("legal")}
              aria-expanded={openSections.legal}
            >
              <h3 className="site-footer-col-title">Legal & Privacy</h3>
              <FontAwesomeIcon
                icon={faChevronDown}
                className={`site-footer-col-toggle-icon${openSections.legal ? " site-footer-col-toggle-icon--open" : ""}`}
                aria-hidden="true"
              />
            </button>
            <ul className={`site-footer-nav-list${openSections.legal ? " site-footer-nav-list--open" : ""}`}>
              <li>
                <button
                  type="button"
                  className="site-footer-link"
                  onClick={(event) => handleOpenModal(event, "privacy")}
                >
                  Privacy & Ownership
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="site-footer-link"
                  onClick={(event) => handleOpenModal(event, "terms")}
                >
                  Terms of Use
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="site-footer-link"
                  onClick={(event) => handleOpenModal(event, "license")}
                >
                  MIT License
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="site-footer-link"
                  onClick={(event) => handleOpenModal(event, "protocol")}
                >
                  Direct Stream Protocol
                </button>
              </li>
            </ul>
          </div>
        </nav>

        {/* ── 2. Product / Platform Utility Links ── */}
        <div className="site-footer-utilities" role="region" aria-label="Platform utility shortcuts">
          <span className="site-footer-util-label">Utilities</span>
          <Link to="/" className="site-footer-util-item" title="Open Web Player">
            <FontAwesomeIcon icon={faGlobe} aria-hidden="true" />
            <span>Web Player</span>
          </Link>
          <a href={ANDROID_APK_URL} className="site-footer-util-item" title="Download Android APK">
            <FontAwesomeIcon icon={faMobileScreen} aria-hidden="true" />
            <span>Android APK</span>
          </a>
          <button
            type="button"
            className="site-footer-util-item"
            onClick={(event) => handleOpenModal(event, "desktop-lan")}
            title="Desktop & Local Network Direct Streaming"
          >
            <FontAwesomeIcon icon={faDesktop} aria-hidden="true" />
            <span>LAN Streaming</span>
          </button>
          <button
            type="button"
            className="site-footer-util-item"
            onClick={(event) => handleOpenModal(event, "self-hosted")}
            title="Self-Hosted Fastify, PostgreSQL & Redis Architecture"
          >
            <FontAwesomeIcon icon={faServer} aria-hidden="true" />
            <span>Self-Hosted</span>
          </button>
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="site-footer-util-item"
            title="View repository on GitHub"
          >
            <FontAwesomeIcon icon={faCodeBranch} aria-hidden="true" />
            <span>Repository</span>
          </a>
        </div>

        {/* ── 3. Divider and Social Bar ── */}
        <hr className="site-footer-divider" />

        <div className="site-footer-bar">
          <Link to="/" className="site-footer-bar-brand" aria-label="DogMedia home">
            <img
              src="/web-app-manifest-192x192.png"
              alt=""
              width="22"
              height="22"
              aria-hidden="true"
            />
            <span>DogMedia</span>
          </Link>

          <div className="site-footer-socials" aria-label="Community and social links">
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="site-footer-social-link"
              aria-label="GitHub Repository"
              title="GitHub"
            >
              <GitHubIcon />
            </a>
            <a
              href="https://discord.gg"
              target="_blank"
              rel="noopener noreferrer"
              className="site-footer-social-link"
              aria-label="Discord Community"
              title="Discord"
            >
              <DiscordIcon />
            </a>
            <a
              href="https://x.com"
              target="_blank"
              rel="noopener noreferrer"
              className="site-footer-social-link"
              aria-label="X (formerly Twitter)"
              title="X"
            >
              <TwitterXIcon />
            </a>
          </div>
        </div>

        {/* ── 4. Oversized Brand Wordmark ── */}
        <div className="site-footer-wordmark-wrap" aria-hidden="true">
          <span className="site-footer-wordmark">DOGMEDIA</span>
        </div>

        {/* ── 5. Fine Print ── */}
        <div className="site-footer-fine-print">
          <span>© {currentYear} DogMedia. All rights reserved.</span>
          <span className="site-footer-fine-print-statement">
            Your media. Your space. Your story. Your rhythm.
          </span>
          <span className="site-footer-fine-print-id">
            Koleksimu, ceritamu, ritmemu sendiri.
          </span>
        </div>
      </div>

      {/* Info Dialog */}
      {activeModal && (
        <InfoModal
          infoKey={activeModal}
          onClose={() => setActiveModal(null)}
        />
      )}
    </footer>
  );
}

export default SiteFooter;
