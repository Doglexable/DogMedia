import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalendar,
  faChevronLeft,
  faChevronRight,
  faCircleInfo,
  faClock,
  faFile,
  faFolder,
  faHardDrive,
} from "@fortawesome/free-solid-svg-icons";
import { getArtistLabel } from "./media-artists";
import { LyricsPanel } from "./lyrics-panel";
import { formatDuration, getMediaFolder, getMediaFolderName } from "./player-utils";

function formatAddedDate(value) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function DetailRow({ icon, label, value, mono = false }) {
  return (
    <div className="now-playing-sidebar-row">
      <FontAwesomeIcon icon={icon} className="now-playing-sidebar-row-icon" />
      <span>{label}</span>
      <strong className={mono ? "now-playing-sidebar-row-value now-playing-sidebar-row-value--mono" : "now-playing-sidebar-row-value"} title={value}>
        {value}
      </strong>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="now-playing-sidebar-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Artwork({ alt, fallbackIcon, isImage, onError, onPreventMenu, src, thumbFailed }) {
  if (!thumbFailed || isImage) {
    return (
      <img
        src={src}
        alt={alt}
        className="now-playing-sidebar-artwork-image"
        draggable={false}
        onContextMenu={onPreventMenu}
        onError={isImage ? undefined : onError}
      />
    );
  }

  return (
    <div className="now-playing-sidebar-artwork-fallback">
      <FontAwesomeIcon icon={fallbackIcon} />
      <span>{alt}</span>
    </div>
  );
}

export function NowPlayingSidebar({
  currentMedia,
  duration,
  isAudio,
  isImage,
  meta,
  onPreventMenu,
  onSeek,
  onThumbError,
  position,
  streamSrc,
  thumbFailed,
  thumbSrc,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const mediaDuration = duration || currentMedia.duration;
  const artist = isAudio ? getArtistLabel(currentMedia.artists) : meta.label;
  const album = getMediaFolderName(currentMedia) || "Library";
  const folder = getMediaFolder(currentMedia) || "Uncategorized";
  const artworkSrc = isImage ? streamSrc : thumbSrc;
  const description = currentMedia.description?.trim();

  return (
    <aside className={collapsed ? "now-playing-sidebar now-playing-sidebar--collapsed" : "now-playing-sidebar"}>
      <button
        type="button"
        className="now-playing-sidebar-toggle"
        aria-label={collapsed ? "Open now playing details" : "Collapse now playing details"}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((open) => !open)}
        title={collapsed ? "Open details" : "Collapse details"}
      >
        <FontAwesomeIcon icon={collapsed ? faChevronLeft : faChevronRight} />
      </button>

      <button
        type="button"
        className="now-playing-sidebar-rail"
        aria-label="Open now playing details"
        onClick={() => setCollapsed(false)}
        title={currentMedia.title}
      >
        <span className="now-playing-sidebar-rail-art">
          {!thumbFailed || isImage ? (
            <img src={artworkSrc} alt="" draggable={false} onError={isImage ? undefined : onThumbError} />
          ) : (
            <FontAwesomeIcon icon={meta.icon} />
          )}
        </span>
        <span className="now-playing-sidebar-rail-label">Now</span>
      </button>

      <div className="now-playing-sidebar-content">
        <div className="now-playing-sidebar-header">
          <span>Now Playing</span>
          <span className="now-playing-sidebar-type">
            <FontAwesomeIcon icon={meta.icon} />
            {meta.label}
          </span>
        </div>

        <div className="now-playing-sidebar-artwork">
          <Artwork
            alt={currentMedia.title}
            fallbackIcon={meta.icon}
            isImage={isImage}
            onError={onThumbError}
            onPreventMenu={onPreventMenu}
            src={artworkSrc}
            thumbFailed={thumbFailed}
          />
        </div>

        <div className="now-playing-sidebar-title-block">
          <h1 title={currentMedia.title}>{currentMedia.title}</h1>
          <p title={artist}>{artist}</p>
          <span title={album}>{album}</span>
        </div>

        {description && (
          <Section title="Description">
            <p className="now-playing-sidebar-description">{description}</p>
          </Section>
        )}

        {isAudio && (
          <LyricsPanel mediaId={currentMedia.id} onSeek={onSeek} position={position} />
        )}

        <Section title="Metadata">
          <div className="now-playing-sidebar-rows">
            <DetailRow icon={faClock} label="Duration" value={mediaDuration ? formatDuration(mediaDuration) : "Unknown"} />
            <DetailRow icon={faFile} label="Format" value={currentMedia.mime_type || "Unknown"} />
            <DetailRow icon={faCalendar} label="Added" value={formatAddedDate(currentMedia.created_at)} />
          </div>
        </Section>

        <Section title="File Location">
          <div className="now-playing-sidebar-rows">
            <DetailRow icon={faFolder} label="Folder" value={folder} />
            <DetailRow icon={faHardDrive} label="Path" value={currentMedia.file_path || "Unavailable"} mono />
          </div>
        </Section>

        <Section title="Technical">
          <div className="now-playing-sidebar-rows">
            <DetailRow icon={faCircleInfo} label="Media ID" value={`#${currentMedia.id}`} mono />
            <DetailRow icon={faCircleInfo} label="Category" value={currentMedia.category_path || currentMedia.category_name || "Uncategorized"} />
          </div>
        </Section>
      </div>
    </aside>
  );
}
