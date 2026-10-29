# Changelog

All notable changes to the Dogmedia Private File Stream project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.7.6] - 2026-10-29

Maintenance, performance, and parity release resolving active streaming memory spikes, desktop artwork cache fragmentation, and UI parity between web container and landing page.

### Fixed & Improved

#### Desktop Playback & Memory Management
- **GStreamer Network Buffer Capping**: Configured `playbin3` network stream parameters (`buffer-duration = 5s`, `buffer-size = 8MB`, `ring-buffer-max-size = 16MB`) to throttle socket reads, enforce TCP backpressure on the server stream, and stop active playback heap retention.
- **MPRIS D-Bus Signal Deduplication**: Added previous-state diffing in MPRIS service to prevent continuous 500ms re-broadcasting of 7 D-Bus properties (`set_playback_status`, `set_metadata`, `set_volume`, `set_can_play`, `set_can_pause`, `set_can_go_previous`, `set_can_go_next`) during playback.
- **Clean Engine Teardown on Track Switch**: Ensured the previous `PlaybackEngine` instance is completely stopped and dropped when transitioning between different media items, preventing lingering decoder graphs.
- **Shared Artwork Version Caching**: Normalized `ArtworkCache` keys by file reference (`artwork:{version}`) across all tracks and categories sharing the same cover version, preventing cache fragmentation and duplicate downloads.
- **Destructive Purge Removal**: Removed destructive `clear_other_media` calls inside `ensure_artwork`, protecting visible on-screen media (like featured cards) from being evicted when other tracks play.
- **Featured Card Reactive Artwork Loader**: Added reactive effect to the desktop `Featured` card to guarantee artwork is loaded automatically.

#### Web & Homepage Parity
- **Homepage Footer Parity**: Elevated `homepage` footer to full parity with `web/src/components/site-footer.jsx`, including interactive info modal and elevated styling.
- **Playback Settings Consolidation**: Consolidated quality selection inside the playback settings dialog.

---

## [0.7.0] - 2026-10-16

Feature and polish release adding fullscreen playback conflict states and session takeover across Web and Mobile, menubar keyboard shortcut styling and dynamic window titles on Desktop, synchronized lyrics autoscrolling with LRCLIB attribution, artwork color palette extraction for lyrics sharing cards, and further video/audio stream memory optimizations.

### Added

#### Fullscreen Playback Conflict & Takeover
- **Web Fullscreen (`FullPlayer` & `VideoPlayer`)**:
  - Reusable `SpotifyConnectBar` rendered in both audio and video fullscreen views when playback is active on another device.
  - Interactive "Play here" takeover button allowing instant session retrieval.
  - Locking of playback controls, transport buttons, scrubber slider, double-click stage actions, and keyboard shortcuts when playback is locked.
  - Automatic layout padding adjustments preventing HUD controls from overlapping the pinned connect bar.
- **Mobile Fullscreen (`full-player.jsx`)**:
  - Spotify Connect pill indicator in fullscreen audio player with instant takeover action.
  - Exclusive session notice and takeover banner on video playback canvas when remote conflict is active.
  - Disabled transport controls, shuffle/loop buttons, and scrubber track during locked playback sessions.

#### Desktop Client (`dogmedia-desktop`)
- **Menubar Keyboard Badges**: Enhanced menu bar shortcuts with styled keyboard badges (`<kbd>`) for quick shortcut discovery.
- **Dynamic Window Title**: Real-time window title updates displaying the current playing track (`{title} by {artist} - Dogmedia` or `{title} - Dogmedia`), triggered per media transition without periodic polling overhead.
- **Synchronized Lyrics Autoscroll**: Smooth lyrics autoscroll in desktop fullscreen view matching web client behavior.
- **LRCLIB Provider Attribution**: Added credit link for LRCLIB lyrics service across desktop and web lyrics views.
- **Lyrics Card Sharing**: Visual lyrics card preview and clip sharing with extracted palette colors.
- **Build & Packaging Cache Cleanup**: Automatic cleanup script (`clean-package-cache.sh`) to purge staging artifacts, Zig caches, and cross-compilation temp files after package builds.

#### Server & Backend (`pfs-server`)
- **Artwork Palette Extraction**: Database migration (`025_artwork_palettes.sql`) and backend worker extracting dominant artwork color palettes via flood-fill background exclusion for lyrics card sharing.
- **Artwork Palette API**: `GET /api/media/:id/artwork-palette` endpoint delivering extracted colors and share card accent values.

### Fixed
- Fixed audio/video stream memory retention by clearing video frame buffers, shrinking vector capacities, evicting old artwork immediately, and trimming glibc memory arenas on media transitions.
- Fixed argument forwarding and isolated Windows pkgconfig from the release directory in packaging scripts.

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
  - Adaptive resolution constraint (640×360 mini-player vs unconstrained fullscreen) reducing decode and texture upload memory bandwidth by >90%.
  - Buffer pool hysteresis (4s cooldown) and atomic caps negotiation rate-limiting to prevent memory thrashing and streaming thread stalls.
  - Quintic Hermite curve (`smooth_uv`) shader filtering for artifact-free viewport upscaling during mini-to-fullscreen transitions.
  - AppSink `max-buffers=1` with QoS and disabled sample retention to eliminate video memory bloat.
  - Subscribed timing signals preventing continuous 60fps UI rerenders.
- **Native MPRIS Support**: Linux D-Bus MPRIS integration for system media keys, desktop metadata displays, and playback control.
- **Dynamic Window Title**: Real-time window title updates displaying currently playing media (`{title} by {artist} - Dogmedia` or `{title} - Dogmedia`), updating per media start without 1-second polling intervals.
- **Subtitles & Synced Lyrics**: Full ASS/SSA and WebVTT subtitle parsing with synchronized cue rendering, plus local `.lrc` lyrics discovery and parsing for offline folders.
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
- Added automatic build and packaging cache cleanup (`clean:desktop:packages`) to automatically purge staging directories, Zig caches, and cross-compilation caches after `package:desktop:*` commands.

### Fixed
- Fixed audio playback unbounded memory growth in desktop client by memoizing slider hit zones, eliminating redundant progress re-renders, throttling UI playback ticks, and trimming fragmented allocator arenas.
- Fixed desktop event loop deadlock/freeze caused by recursive reactive signal updates inside `use_effect`, replacing signal-based debouncing with atomic sequence counters.
- Fixed residual memory retention on server connect/disconnect and local folder switching by purging unneeded cached items and running glibc allocator cleanup.
- Fixed memory ballooning in desktop client when navigating large music directories by bounding artwork cache and virtualizing lists.
- Fixed integer underflow in desktop artwork cache eviction byte calculations.
- Fixed context menu backdrop dismiss behavior on Linux desktop.
- Fixed potential outbox deadlocks in mobile offline synchronization.
- Fixed video player mini-player overlap during web view transitions.
- Fixed duplicate transcoding claims on worker restart by enforcing strict stream claim timeouts.
- Fixed GStreamer decoder graph retention between media track transitions by detaching previous URI before attaching new playback targets.
- Fixed remote stream state memory retention by clearing video frame buffers, shrinking vector capacities, immediately evicting old artwork, and trimming glibc allocators on track changes and playback stop.
- Fixed lyrics toggle button accessibility in desktop full player to always remain interactive with empty-state messages when lyrics are missing.

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
