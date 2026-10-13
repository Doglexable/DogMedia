# Changelog

All notable changes to the Dogmedia Private File Stream project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.5.0] - 2026-10-13

Comprehensive multi-platform release introducing the native Rust desktop client, real-time WebSocket session synchronization, Spotify-style queue sidebars, unified Spotify Connect-style playback coordination, and extensive performance/memory optimizations.

### Added

#### Desktop Client (`dogmedia-desktop`)
- **Native GUI & Engine**: Built with Rust, Dioxus Native / Blitz, and GStreamer for hardware-accelerated audio and video playback.
- **Native Menubar**: Integrated `rust-ui` top menubar providing App, Library, Playback, and View menus with keyboard shortcuts.
- **Sliding Queue Sidebar**: Spotify-style sliding right-hand queue panel with animated transitions and virtualized track lists.
- **Unified Connect Bar**: Spotify Connect-inspired status bar displaying active session holder, device info, and takeover controls.
- **Real-Time WebSocket Protocol**: Subscribes to `/api/playback/ws` for sub-second synchronization of playback state and exclusive leases.
- **Bounded RAM & Disk Caching**:
  - Disk-backed artwork cache (`file://` URLs) with instant LRU eviction and memory bounds.
  - Video buffer recycling and NV12 color formatting, reducing frame memory by 62.5%.
  - AppSink `max-buffers=1` with QoS and disabled sample retention to eliminate video memory bloat.
  - Subscribed timing signals preventing continuous 60fps UI rerenders.
- **Native MPRIS Support**: Linux D-Bus MPRIS integration for system media keys, desktop metadata displays, and playback control.
- **Subtitles & Lyrics**: Full ASS/SSA and WebVTT subtitle parsing with synchronized cue rendering.
- **Local Folder Fallback**: Browse and play media directly from local directories without network access.
- **Packaging & Distribution**: Automated packaging for Debian (`.deb`), RPM (`.rpm`), Flatpak, and macOS (`.dmg`) cross-compilation.

#### Web Client (`pfs-web`)
- **Spotify Connect Bar**: Real-time notification bar displaying remote playback conflicts, active session device, and instant takeover.
- **Sliding Queue Drawer**: Redesigned player queue sliding out from the right without obscuring navigation or library context.
- **10-Band Equalizer**: Web Audio API-based equalizer with frequency presets and preamp controls.
- **LRCLIB Synced Lyrics**: Integrated LRCLIB provider for synchronized lyric display alongside local LRC files.
- **Subtitles & Video Enhancements**: Native WebVTT/ASS styling in video player.
- **Sleep Timer**: Customizable countdown timer with audio fadeout and completion dialog.
- **Modular Admin Console**: Decomposed monolithic admin interface into `CategoryManager`, `MediaUploadWorkspace`, `MobileReleaseManager`, and `UploadQueueViewer`.

#### Mobile Client (`pfs-mobile`)
- **UI/UX Overhaul**: Spotify-inspired design system powered by `react-native-ui-lib`.
- **SQLite Offline Store**: Bounded offline download cache with quality tier enforcement (`ori`, `1080p`, `720p`, `480p`) and outbox synchronization.
- **Audio Load Sequence Lock**: Concurrency guards preventing audio track overlap and background player leaks.
- **Synced Lyrics Panel**: Interactive sheet with draggable snap points and active line highlighting.
- **Real-Time Lease Management**: Live WebSocket status updates with remote playback detection and takeover requests.

#### Server & Backend (`pfs-server`)
- **Real-Time WebSocket Transport**: `/api/playback/ws` endpoint using ticketed authentication for instant multi-client playback broadcasts.
- **Exclusive Playback Holder**: Session-scoped leasing logic in Redis preventing playback collisions across devices.
- **On-Demand Video Transcoding**: Dynamic worker claims with configurable idle timeouts and failure retry caps.
- **Orphan Media Pruner**: Scheduled background worker pruning unlinked artwork, thumbnails, and temp files with configurable grace periods.
- **Search Optimization**: PostgreSQL trigram index integration for fast full-text browse queries.
- **Security & Authorization**: IP whitelist authorization with CIDR range matching, strict header spoofing defenses, and localhost guards on admin endpoints.

### Changed
- Migrated desktop settings and dialogs to composable `rust-ui` primitives.
- Replaced polling intervals with reactive WebSocket event streams for active playback sessions.
- Enhanced database migrations runner to wrap migrations in atomic PostgreSQL transactions.
- Upgraded Fastify dependencies past vulnerable multi-part busboy advisories.
- Containerized development and production pipelines with rootless Podman Compose.

### Fixed
- Fixed audio playback unbounded memory growth in desktop client by memoizing slider hit zones, eliminating redundant progress re-renders, throttling UI playback ticks, and trimming fragmented allocator arenas.
- Fixed residual memory retention on server connect/disconnect and local folder switching by purging unneeded cached items and running glibc allocator cleanup.
- Fixed memory ballooning in desktop client when navigating large music directories by bounding artwork cache and virtualizing lists.
- Fixed integer underflow in desktop artwork cache eviction byte calculations.
- Fixed context menu backdrop dismiss behavior on Linux desktop.
- Fixed potential outbox deadlocks in mobile offline synchronization.
- Fixed video player mini-player overlap during web view transitions.
- Fixed duplicate transcoding claims on worker restart by enforcing strict stream claim timeouts.

---

## [0.1.0] - 2026-07-20

Initial release of the Dogmedia Private File Stream application.

### Added
- Fastify backend with HTTP range streaming for audio, video, and photos.
- React/Vite single-page application frontend.
- React Native / Expo mobile client foundation.
- IP-based access control (access tiers 0, 100, 999) without username/password requirements.
- Redis-backed media queues and active session tracking.
- Metadata extraction and thumbnail generation for media uploads.
- Category organization and basic search functionality.
