mod kit;
pub mod menubar;
#[cfg(target_os = "linux")]
mod system_theme;
mod video_surface;
mod views;

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicI8, AtomicU64, Ordering};
use std::time::Instant;

use base64::Engine as _;
use dioxus_native::prelude::*;
use tokio::sync::mpsc;

use crate::{
    api::{
        ApiClient, ApiError, Endpoint, ServerUrlError,
        playback_socket::{self, SocketCommand, SocketEvent},
    },
    app::{AccessView, AppState},
    domain::{
        BrowseQuery, Category, CategoryId, DashboardQuery, DashboardSummary, Limit, LocalKind,
        LocalTrack, Media, MediaFilter, MediaId, PlaybackReport, PlaybackSession, Quality,
        QueueItem, QueueOrder, QueueWindow, SessionHolder, SubtitleTrack, Volume,
        scan_local_folder,
    },
    integration::mpris::{MprisBridge, MprisCommand, MprisState},
    playback::{
        EngineEvent, PlaybackCoordinator, PlaybackEngine, PlaybackStatus, RedrawCallback,
        RepeatMode, VideoFrameReceiver,
    },
    store::{ColorScheme, Settings, SettingsError, SettingsStore, artwork_cache_path},
};

pub(crate) use kit::{
    Artwork, Button, Chip, Draggable, DraggableItem, DraggableZone, Icon, IconButton, IconName,
    Input, MediaListSkeleton, MusicProgress, Notice, Popover, PopoverContent, PopoverTrigger,
    Select, Skeleton, Slider, StatusBadge, ThemeToggle, VolumeSlider,
};
use video_surface::VideoPaintSource;
use views::Shell;

const CSS: &str = concat!(
    include_str!("../../assets/tailwind.css"),
    include_str!("../../assets/native.css")
);

#[derive(Clone, Debug, PartialEq)]
struct SubtitleCue {
    start: f64,
    end: f64,
    text: String,
}

const ARTWORK_CACHE_LIMIT: usize = 96;
const ARTWORK_CACHE_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
enum ArtworkState {
    Loading,
    Ready(Arc<String>),
    Missing,
}

#[derive(Clone, Debug, Default)]
struct ArtworkCache {
    entries: HashMap<String, ArtworkState>,
    order: VecDeque<String>,
    ready_bytes: usize,
}

impl ArtworkCache {
    fn key(media: &Media) -> String {
        format!(
            "media:{}:{}",
            media.id,
            media.artwork_version.as_deref().unwrap_or("none")
        )
    }

    fn category_key(category: &Category) -> String {
        format!(
            "category:{}:{}",
            category.id,
            category.cover_path.as_deref().unwrap_or("none")
        )
    }

    fn get(&self, media: &Media) -> Option<&ArtworkState> {
        self.entries.get(&Self::key(media))
    }

    fn get_category(&self, category: &Category) -> Option<&ArtworkState> {
        self.entries.get(&Self::category_key(category))
    }

    fn start(&mut self, media: &Media) -> Option<String> {
        self.start_key(Self::key(media))
    }

    fn start_category(&mut self, category: &Category) -> Option<String> {
        self.start_key(Self::category_key(category))
    }

    fn start_key(&mut self, key: String) -> Option<String> {
        if self.entries.contains_key(&key) {
            return None;
        }
        while self.entries.len() >= ARTWORK_CACHE_LIMIT {
            if let Some(oldest) = self.order.pop_front() {
                self.evict(&oldest);
            }
        }
        self.order.push_back(key.clone());
        self.entries.insert(key.clone(), ArtworkState::Loading);
        Some(key)
    }

    fn finish(&mut self, key: String, state: ArtworkState) {
        if self.entries.contains_key(&key) {
            self.evict_bytes(&key);
            self.entries.insert(key.clone(), ArtworkState::Loading);
            let size = match &state {
                ArtworkState::Ready(value) => value.len(),
                _ => 0,
            };
            if size > ARTWORK_CACHE_BYTES {
                self.entries.insert(key, ArtworkState::Missing);
                return;
            }
            while self.ready_bytes + size > ARTWORK_CACHE_BYTES {
                let Some(oldest) = self
                    .order
                    .iter()
                    .find(|entry| matches!(self.entries.get(*entry), Some(ArtworkState::Ready(_))))
                    .cloned()
                else {
                    break;
                };
                self.evict(&oldest);
                self.order.retain(|entry| entry != &oldest);
            }
            self.ready_bytes += size;
            self.entries.insert(key, state);
        }
    }

    fn evict_bytes(&mut self, key: &str) {
        if let Some(ArtworkState::Ready(value)) = self.entries.get(key) {
            self.ready_bytes = self.ready_bytes.saturating_sub(value.len());
        }
    }

    fn evict(&mut self, key: &str) {
        if let Some(file_path) = match self.entries.get(key) {
            Some(ArtworkState::Ready(url)) => url::Url::parse(url)
                .ok()
                .and_then(|u| u.to_file_path().ok()),
            _ => None,
        } {
            let _ = std::fs::remove_file(file_path);
        }
        self.evict_bytes(key);
        self.entries.remove(key);
    }

    fn remove(&mut self, key: &str) {
        self.evict(key);
        self.order.retain(|entry| entry != key);
    }

    fn clear_other_media(&mut self, keep_media: Option<&Media>) {
        let keep_key = keep_media.map(Self::key);
        let media_keys: Vec<String> = self
            .entries
            .keys()
            .filter(|key| key.starts_with("media:") && keep_key.as_deref() != Some(key.as_str()))
            .cloned()
            .collect();
        for key in media_keys {
            self.remove(&key);
        }
    }

    fn clear_all(&mut self) {
        let keys: Vec<String> = self.entries.keys().cloned().collect();
        for key in &keys {
            self.evict(key);
        }
        self.entries.clear();
        self.order.clear();
        self.ready_bytes = 0;
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PlaybackTiming {
    pub position: f64,
    pub duration: f64,
}

#[derive(Clone)]
pub(crate) struct NativeApp {
    store: SettingsStore,
    settings: Settings,
    system_color_scheme: Option<ColorScheme>,
    client: Option<ApiClient>,
    library: AppState,
    categories: Vec<Category>,
    dashboard: DashboardSummary,
    dashboard_generation: u64,
    artwork: ArtworkCache,
    search: String,
    media_filter: MediaFilter,
    category_id: Option<CategoryId>,
    favorites_only: bool,
    queue: Option<QueueWindow>,
    local_tracks: Vec<LocalTrack>,
    local_index: Option<usize>,
    local_mode: bool,
    local_scan_generation: u64,
    engine_signal: Option<Signal<Option<PlaybackEngine>>>,
    timing_signal: Option<Signal<PlaybackTiming>>,
    video_frames: VideoFrameReceiver,
    redraw_callback: Option<RedrawCallback>,
    coordinator: PlaybackCoordinator,
    session: Option<PlaybackSession>,
    socket_sender: Option<mpsc::Sender<SocketCommand>>,
    socket_ready: bool,
    socket_session_id: Option<String>,
    socket_sequence: u64,
    socket_last_signature: Option<String>,
    socket_last_report_at: Option<Instant>,
    socket_last_revision: Option<u64>,
    lyrics: String,
    lyrics_visible: bool,
    subtitles: Vec<SubtitleTrack>,
    selected_subtitle: Option<usize>,
    subtitle_cues: Vec<SubtitleCue>,
    photo_data_url: Option<Arc<String>>,
    player_expanded: bool,
    quality_popover_open: bool,
    queue_open: bool,
    settings_open: bool,
    settings_url: String,
    settings_error: Option<String>,
    settings_connecting: bool,
    session_takeover_pending: bool,
    access_tier: i32,
    allow_http: bool,
    status: Option<String>,
}

impl NativeApp {
    fn boot() -> Self {
        let store = SettingsStore::discover().unwrap_or_else(|error| {
            tracing::warn!(%error, "using local native settings fallback");
            SettingsStore::at("dogmedia-settings.json")
        });
        let settings = store.load().unwrap_or_else(|error| {
            tracing::warn!(%error, "using default native settings");
            Settings::default()
        });
        let (client, access, status) = if settings.configured {
            let server_url = settings.server_url.to_string();
            match ApiClient::new(&server_url, settings.viewer_id.clone()) {
                Ok(client) => (Some(client), AccessView::Checking, None),
                Err(error) => (None, AccessView::Unreachable(error.user_message()), None),
            }
        } else {
            (
                None,
                AccessView::FirstRun,
                Some("Configure the server in the current desktop client first.".to_owned()),
            )
        };
        let mut library = AppState::default();
        library.access = access;
        let mut coordinator = PlaybackCoordinator::default();
        coordinator.set_quality(settings.quality);
        let settings_open = !settings.configured;
        let settings_url = settings.server_url.to_string();
        #[cfg(target_os = "linux")]
        let system_color_scheme = system_theme::read_gsettings_scheme();
        #[cfg(not(target_os = "linux"))]
        let system_color_scheme = None;
        Self {
            store,
            settings,
            system_color_scheme,
            client,
            library,
            categories: Vec::new(),
            dashboard: DashboardSummary::default(),
            dashboard_generation: 0,
            artwork: ArtworkCache::default(),
            search: String::new(),
            media_filter: MediaFilter::All,
            category_id: None,
            favorites_only: false,
            queue: None,
            local_tracks: Vec::new(),
            local_index: None,
            local_mode: false,
            local_scan_generation: 0,
            engine_signal: None,
            timing_signal: None,
            video_frames: VideoFrameReceiver::default(),
            redraw_callback: None,
            coordinator,
            session: None,
            socket_sender: None,
            socket_ready: false,
            socket_session_id: None,
            socket_sequence: 0,
            socket_last_signature: None,
            socket_last_report_at: None,
            socket_last_revision: None,
            lyrics: String::new(),
            lyrics_visible: true,
            subtitles: Vec::new(),
            selected_subtitle: None,
            subtitle_cues: Vec::new(),
            photo_data_url: None,
            player_expanded: false,
            quality_popover_open: false,
            queue_open: false,
            settings_open,
            settings_url,
            settings_error: None,
            settings_connecting: false,
            session_takeover_pending: false,
            access_tier: 0,
            allow_http: false,
            status,
        }
    }

    fn query(&self) -> BrowseQuery {
        BrowseQuery {
            search: self.search.clone(),
            media_type: self.media_filter,
            category_id: self.category_id,
            liked: self.favorites_only,
            cursor: None,
            limit: Limit::new(50),
        }
    }
}

#[cfg(all(target_os = "linux", target_env = "gnu"))]
fn trim_allocator() {
    unsafe {
        unsafe extern "C" {
            fn malloc_trim(pad: usize) -> i32;
        }
        let _ = malloc_trim(0);
    }
}

#[cfg(not(all(target_os = "linux", target_env = "gnu")))]
fn trim_allocator() {}

impl NativeApp {
    pub(crate) fn purge_server_memory(&mut self) {
        self.categories.clear();
        self.categories.shrink_to_fit();
        self.library.clear();
        self.dashboard_generation += 1;
        self.dashboard = DashboardSummary::default();
        self.queue = None;
        self.session = None;
        self.photo_data_url = None;
        self.lyrics.clear();
        self.lyrics.shrink_to_fit();
        self.subtitles.clear();
        self.subtitles.shrink_to_fit();
        self.subtitle_cues.clear();
        self.subtitle_cues.shrink_to_fit();
        self.artwork.clear_all();
        self.socket_ready = false;
        self.socket_session_id = None;
        self.socket_last_signature = None;
        self.socket_last_revision = None;
        self.video_frames.clear();
        trim_allocator();
    }

    pub(crate) fn purge_local_memory(&mut self) {
        self.local_scan_generation += 1;
        self.local_tracks.clear();
        self.local_tracks.shrink_to_fit();
        self.local_index = None;
        self.local_mode = false;
        self.artwork.clear_all();
        self.photo_data_url = None;
        self.lyrics.clear();
        self.lyrics.shrink_to_fit();
        self.subtitles.clear();
        self.subtitles.shrink_to_fit();
        self.subtitle_cues.clear();
        self.subtitle_cues.shrink_to_fit();
        self.video_frames.clear();
        trim_allocator();
    }

    pub(crate) fn on_server_connected(&mut self) {
        let current_media = self.coordinator.snapshot().media.clone();
        self.purge_local_memory();
        self.artwork.clear_other_media(current_media.as_ref());
        self.photo_data_url = None;
        self.library.clear();
        self.dashboard_generation += 1;
        self.dashboard = DashboardSummary::default();
    }

    pub(crate) fn on_server_disconnected(&mut self) {
        self.purge_server_memory();
        self.coordinator.stop();
        if let Some(engine) = self.engine_signal
            && let Some(player) = engine.read().as_ref()
        {
            let _ = player.stop();
        }
    }
}

fn app_window_icon() -> Option<winit::window::Icon> {
    let img = image::load_from_memory(include_bytes!("../../assets/brand-mark.png")).ok()?;
    let rgba = img.into_rgba8();
    let (width, height) = rgba.dimensions();
    winit::window::Icon::from_rgba(rgba.into_raw(), width, height).ok()
}

#[cfg(target_os = "linux")]
fn window_theme(preference: ColorScheme, system: Option<ColorScheme>) -> winit::window::Theme {
    match if preference == ColorScheme::System {
        system.unwrap_or(ColorScheme::Light)
    } else {
        preference
    } {
        ColorScheme::Dark => winit::window::Theme::Dark,
        ColorScheme::Light | ColorScheme::System => winit::window::Theme::Light,
    }
}

pub fn run() {
    // Ensure environment variables for Dioxus CLI config have Dogmedia identity
    if std::env::var("DIOXUS_APP_TITLE").is_err() {
        // SAFETY: Called on main thread before spawning background threads or runtime.
        unsafe { std::env::set_var("DIOXUS_APP_TITLE", "Dogmedia") };
    }
    if std::env::var("DIOXUS_PRODUCT_NAME").is_err() {
        // SAFETY: Called on main thread before spawning background threads or runtime.
        unsafe { std::env::set_var("DIOXUS_PRODUCT_NAME", "Dogmedia") };
    }

    // Dioxus Native owns the main-thread event loop, while API requests and
    // timers use Tokio. Keep a multithread runtime alive and entered for the
    // full Blitz event-loop lifetime so hooks can create Tokio I/O and timers.
    let runtime =
        tokio::runtime::Runtime::new().expect("failed to initialize the native async runtime");
    let _runtime_guard = runtime.enter();

    let mut window_attributes = dioxus_native::WindowAttributes::default()
        .with_title("Dogmedia")
        .with_inner_size(dioxus_native::LogicalSize::new(1280.0, 800.0))
        .with_min_inner_size(dioxus_native::LogicalSize::new(800.0, 560.0));

    #[cfg(target_os = "linux")]
    {
        use winit::platform::wayland::WindowAttributesExtWayland;
        use winit::platform::x11::WindowAttributesExtX11;
        let preference = SettingsStore::discover()
            .and_then(|store| store.load())
            .map(|settings| settings.color_scheme)
            .unwrap_or_default();
        let system_scheme = (preference == ColorScheme::System)
            .then(system_theme::read_gsettings_scheme)
            .flatten();
        window_attributes =
            window_attributes.with_theme(Some(window_theme(preference, system_scheme)));
        window_attributes = WindowAttributesExtWayland::with_name(
            window_attributes,
            "com.dogmedia.Desktop",
            "dogmedia-desktop",
        );
        window_attributes = WindowAttributesExtX11::with_name(
            window_attributes,
            "dogmedia-desktop",
            "com.dogmedia.Desktop",
        );
    }

    if let Some(icon) = app_window_icon() {
        window_attributes = window_attributes.with_window_icon(Some(icon));
    }

    dioxus_native::launch_cfg(App, vec![], vec![Box::new(window_attributes)]);
}

#[component]
fn App() -> Element {
    let mut app = use_signal(NativeApp::boot);
    let native_window = try_consume_context::<Arc<winit::window::Window>>();
    #[cfg(target_os = "linux")]
    use_future(move || async move {
        loop {
            let detected = system_theme::read().await;
            if app.read().system_color_scheme != detected {
                app.write().system_color_scheme = detected;
            }
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        }
    });
    #[cfg(target_os = "linux")]
    {
        let theme_window = native_window.clone();
        use_effect(move || {
            if let Some(window) = theme_window.as_ref() {
                let snapshot = app.read();
                let theme =
                    window_theme(snapshot.settings.color_scheme, snapshot.system_color_scheme);
                if window.theme() != Some(theme) {
                    window.set_theme(Some(theme));
                }
            }
        });
    }
    let redraw_handle = try_consume_context::<WindowRedrawHandle>();
    let trigger_redraw = {
        let redraw_handle = redraw_handle.clone();
        let native_window = native_window.clone();
        Arc::new(move || {
            if let Some(handle) = redraw_handle.as_ref() {
                handle.request_redraw();
            } else if let Some(window) = native_window.as_ref() {
                window.request_redraw();
            }
        })
    };
    let engine = use_signal(|| None::<PlaybackEngine>);
    let timing = use_signal(PlaybackTiming::default);
    provide_context(timing);
    let effect_trigger = trigger_redraw.clone();
    use_effect(move || {
        if let Some(engine_ref) = engine.read().as_ref() {
            engine_ref.set_redraw_callback(effect_trigger.clone());
        }
    });
    // Video repaint is driven by the GStreamer new-sample callback at source
    // rate (~24Hz). A 60Hz full-window redraw loop here only queues redundant
    // composites of the whole Shell (lists, artwork, video) and was measured
    // to cap effective renders at ~20/s (see GPU_OFFLOAD_MAP.md). Keep a slow
    // 2Hz fallback so a stalled new-sample still refreshes the surface.
    let video_trigger = trigger_redraw.clone();
    use_future(move || {
        let video_trigger = video_trigger.clone();
        async move {
            loop {
                let is_video_playing = {
                    let snapshot = app.read();
                    let coordinator = snapshot.coordinator.snapshot();
                    coordinator.status == PlaybackStatus::Playing
                        && coordinator.media.as_ref().is_some_and(|m| m.is_video())
                };
                if is_video_playing {
                    video_trigger();
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                } else {
                    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                }
            }
        }
    });
    let mpris = use_hook(MprisBridge::start);
    let frames = use_hook(|| app.read().video_frames.clone());
    let video_source_id = dioxus_native::use_wgpu(move || VideoPaintSource::new(frames.clone()));
    use_hook(move || {
        app.write().engine_signal = Some(engine);
        app.write().timing_signal = Some(timing);
        app.write().redraw_callback = Some(trigger_redraw.clone());
        connect(app);
        if matches!(app.read().library.access, AccessView::Unreachable(_)) {
            auto_open_local_folder(app);
        }
    });
    use_drop(move || {
        if let Some(engine) = engine.read().as_ref() {
            let _ = engine.stop();
        }
        let client = app.read().client.clone();
        let session = app.read().session.clone();
        if let (Some(client), Some(session)) = (client, session) {
            let release = std::thread::Builder::new()
                .name("dogmedia-session-release".to_owned())
                .spawn(move || {
                    if let Ok(runtime) = tokio::runtime::Runtime::new() {
                        let _ = runtime.block_on(client.release(&session));
                    }
                });
            if let Ok(release) = release {
                let _ = release.join();
            }
        }
    });
    let playback_mpris = mpris.clone();
    use_future(move || {
        let playback_mpris = playback_mpris.clone();
        async move {
            publish_mpris_state(app, engine, &playback_mpris);
            loop {
                // Full rate only while progress is possible; paused/stopped/
                // idle ticks only refresh MPRIS/lease state (Plan 059).
                let active = {
                    let state = app.read();
                    let playback = state.coordinator.snapshot();
                    !playback.session_unavailable
                        && matches!(
                            playback.status,
                            PlaybackStatus::Playing | PlaybackStatus::Loading
                        )
                };
                tokio::time::sleep(std::time::Duration::from_millis(if active {
                    500
                } else {
                    1000
                }))
                .await;
                tick_playback(app, engine);
                publish_mpris_state(app, engine, &playback_mpris);
            }
        }
    });
    let command_mpris = mpris.clone();
    use_future(move || {
        let command_mpris = command_mpris.clone();
        async move {
            while let Some(command) = command_mpris.next_command().await {
                handle_mpris_command(app, engine, command);
            }
        }
    });
    use_future(move || async move {
        loop {
            let client = if app.read().local_mode {
                None
            } else {
                app.read().client.clone()
            };
            let Some(client) = client else {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                continue;
            };
            let server = client.base_url().to_string();
            let (command_tx, command_rx) = mpsc::channel(16);
            let (event_tx, mut event_rx) = mpsc::channel(16);
            app.write().socket_sender = Some(command_tx);
            let task = tokio::spawn(playback_socket::run(client.clone(), command_rx, event_tx));
            loop {
                tokio::select! {
                    event = event_rx.recv() => {
                        let Some(event) = event else { break; };
                        if app.read().local_mode { break; }
                        match event {
                            SocketEvent::Ready => {
                                let mut state = app.write();
                                state.socket_ready = true;
                                state.socket_session_id = None;
                                state.socket_last_signature = None;
                                state.socket_last_revision = None;
                            }
                            SocketEvent::Disconnected => {
                                let mut state = app.write();
                                state.socket_ready = false;
                                state.socket_session_id = None;
                                state.socket_last_signature = None;
                                state.socket_last_revision = None;
                                if state.session.is_none() && state.coordinator.snapshot().session_unavailable {
                                    state.coordinator.remote_available();
                                }
                            }
                            SocketEvent::Error { code, session_id } => {
                                if code == "PLAYBACK_LEASE_LOST" {
                                    let stale = session_id.as_deref().is_some_and(|revoked| {
                                        app.read().session.as_ref().map(|current| current.session_id.as_str()) != Some(revoked)
                                    });
                                    if !stale {
                                        if let Some(engine) = engine.read().as_ref() { let _ = engine.stop(); }
                                        app.write().socket_ready = true;
                                    }
                                }
                            }
                            SocketEvent::Lease { revision, state, holder, .. } => {
                                let stale = {
                                    let snapshot = app.read();
                                    snapshot.socket_last_revision.is_some_and(|last| revision < last)
                                };
                                if stale { continue; }
                                app.write().socket_last_revision = Some(revision);
                                if state == "busy" {
                                    let (has_session, was_unavailable, current_media) = {
                                        let snapshot = app.read();
                                        let playback = snapshot.coordinator.snapshot();
                                        (snapshot.session.is_some(), playback.session_unavailable, playback.media.clone())
                                    };
                                    if has_session
                                        && let Some(engine) = engine.read().as_ref() { let _ = engine.stop(); }
                                    let same_media = was_unavailable
                                        && current_media.as_ref().map(|media| media.id)
                                            == holder.as_ref().and_then(|value| value.media_id);
                                    if same_media {
                                        if let (Some(media), Some(holder)) = (current_media, holder.clone()) {
                                            ensure_artwork(app, media.clone());
                                            app.write().coordinator.observe_remote(media, holder);
                                        }
                                    } else {
                                        apply_remote_holder(app, engine, &client, holder, "Playback is active elsewhere").await;
                                    }
                                } else if state == "available" {
                                    // Keep the observer player mounted until an in-flight
                                    // takeover has acquired a new session or failed.
                                    let takeover_pending = app.read().session_takeover_pending;
                                    if !takeover_pending {
                                        app.write().coordinator.remote_available();
                                    }
                                }
                            }
                        }
                    }
                    () = tokio::time::sleep(std::time::Duration::from_secs(1)) => {
                        if app.read().local_mode || app.read().client.as_ref().map(|value| value.base_url().to_string()) != Some(server.clone()) { break; }
                    }
                }
            }
            task.abort();
            let mut state = app.write();
            state.socket_ready = false;
            state.socket_sender = None;
            state.socket_session_id = None;
        }
    });
    let last_expanded = use_hook(|| Arc::new(AtomicI8::new(-1)));
    let constraint_seq = use_hook(|| Arc::new(AtomicU64::new(0)));
    use_effect(move || {
        let expanded = app.read().player_expanded;
        let current_val = if expanded { 1 } else { 0 };
        let prev = last_expanded.swap(current_val, Ordering::SeqCst);
        if prev == current_val {
            return;
        }

        let seq = constraint_seq.fetch_add(1, Ordering::SeqCst) + 1;
        let seq_clone = constraint_seq.clone();
        spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            if seq_clone.load(Ordering::SeqCst) == seq
                && let Some(engine) = engine.read().as_ref()
            {
                if expanded {
                    engine.set_video_constraint(None, None);
                } else {
                    engine.set_video_constraint(Some(640), Some(360));
                }
            }
        });
    });
    use_future(move || async move {
        loop {
            // Lease heartbeat every 5s against the 30s server lease
            // (EXCLUSIVE_PLAYBACK_LEASE_SECONDS): worst-case takeover
            // detection ~5s with ~5 missed beats of network tolerance.
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            let socket_ready = app.read().socket_ready;
            if !socket_ready {
                heartbeat(app, engine);
            }
        }
    });

    rsx! { Shell { app, engine, video_source_id } }
}

fn connect(mut app: Signal<NativeApp>) {
    let Some(client) = app.read().client.clone() else {
        return;
    };
    // Never carry takeover authorization across a reconnect or server change.
    app.write().access_tier = 0;
    spawn(async move {
        match client.check_access().await {
            Ok(status) => {
                exit_local_mode(app);
                {
                    let mut state = app.write();
                    state.on_server_connected();
                    state.access_tier = status.tier;
                    state.library.access = AccessView::Ready;
                    state.settings_connecting = false;
                    state.settings_error = None;
                }
                match client.categories().await {
                    Ok(value) => {
                        app.write().categories = value.clone();
                        for category in value {
                            ensure_category_artwork(app, category);
                        }
                    }
                    Err(error) => app.write().status = Some(error.user_message()),
                }
                begin_browse(app);
                load_queue(app);
            }
            Err(ApiError::AccessDenied) => {
                let msg = "Access Denied: Server reached, but this computer's IP is not whitelisted (tier < 100). Please add this IP in the server whitelist.".to_owned();
                let mut state = app.write();
                state.on_server_disconnected();
                state.library.access = AccessView::Denied;
                state.settings_connecting = false;
                state.status = Some(msg);
            }
            Err(error) => {
                let user_msg = error.user_message();
                let mut state = app.write();
                state.on_server_disconnected();
                state.library.access = AccessView::Unreachable(user_msg);
                state.settings_connecting = false;
                state.status = None;
                drop(state);
                auto_open_local_folder(app);
            }
        }
    });
}

fn auto_open_local_folder(app: Signal<NativeApp>) {
    let snapshot = app.read();
    if snapshot.local_mode {
        return;
    }
    let path = snapshot.settings.local_folder.clone();
    let engine = snapshot.engine_signal;
    drop(snapshot);
    if let (Some(path), Some(engine)) = (path, engine) {
        open_local_folder(app, engine, path);
    }
}

fn exit_local_mode(mut app: Signal<NativeApp>) {
    let engine = app.read().engine_signal;
    {
        let mut state = app.write();
        if !state.local_mode {
            return;
        }
        state.purge_local_memory();
        state.queue = None;
        state.queue_open = false;
        state.coordinator.stop();
    }
    if let Some(engine) = engine
        && let Some(player) = engine.read().as_ref()
    {
        let _ = player.stop();
    }
}

fn refresh(mut app: Signal<NativeApp>) {
    app.write().status = None;
    connect(app);
}

pub(crate) fn pick_local_folder(app: Signal<NativeApp>, engine: Signal<Option<PlaybackEngine>>) {
    spawn(async move {
        let path = tokio::task::spawn_blocking(|| rfd::FileDialog::new().pick_folder())
            .await
            .ok()
            .flatten();
        if let Some(path) = path {
            open_local_folder(app, engine, path);
        }
    });
}

fn open_local_folder(
    mut app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
    path: PathBuf,
) {
    let generation = {
        let mut state = app.write();
        state.local_scan_generation += 1;
        state.local_scan_generation
    };
    spawn(async move {
        let scan_path = path.clone();
        let result = tokio::task::spawn_blocking(move || scan_local_folder(&scan_path)).await;
        if app.read().local_scan_generation != generation
            || !matches!(app.read().library.access, AccessView::Unreachable(_))
        {
            return;
        }
        let tracks = match result {
            Ok(Ok(tracks)) if !tracks.is_empty() => tracks,
            Ok(Ok(_)) => {
                app.write().status =
                    Some("This folder contains no supported audio or video files.".to_owned());
                return;
            }
            Ok(Err(error)) => {
                app.write().status = Some(format!("Cannot open local folder: {error}"));
                return;
            }
            Err(error) => {
                app.write().status = Some(format!("Folder scan failed: {error}"));
                return;
            }
        };
        if let Some(player) = engine.read().as_ref() {
            let _ = player.stop();
        }
        {
            let mut state = app.write();
            state.purge_server_memory();
            state.local_tracks = tracks;
            state.local_index = None;
            state.local_mode = true;
            state.settings_open = false;
            state.settings.local_folder = Some(path);
            state.status = None;
            if let Err(error) = state.store.save(&state.settings) {
                state.status = Some(error.to_string());
            }
        }
        play_local_at(app, engine, 0);
    });
}

fn local_media(track: &LocalTrack, index: usize) -> Media {
    Media {
        id: MediaId::new(index as i64 + 1),
        title: Some(track.title.clone()),
        artists: None,
        description: None,
        duration: track.duration,
        mime_type: Some(
            match track.kind {
                LocalKind::Audio => "audio/mpeg",
                LocalKind::Video => "video/mp4",
            }
            .to_owned(),
        ),
        category_id: None,
        category_name: track
            .path
            .parent()
            .and_then(|path| path.file_name())
            .map(|name| name.to_string_lossy().into_owned()),
        category_path: None,
        artwork_version: None,
        liked: false,
        source_version: None,
        created_at: None,
    }
}

fn ensure_playback_engine(
    app: Signal<NativeApp>,
    mut engine: Signal<Option<PlaybackEngine>>,
) -> Result<(), String> {
    if engine.read().is_some() {
        return Ok(());
    }
    let state = app.read();
    let receiver = state.video_frames.clone();
    let redraw_callback = state.redraw_callback.clone();
    drop(state);
    let player =
        PlaybackEngine::with_frame_receiver(receiver).map_err(|error| error.to_string())?;
    if let Some(callback) = redraw_callback {
        player.set_redraw_callback(callback);
    }
    if !app.read().player_expanded {
        player.set_video_constraint(Some(640), Some(360));
    }
    *engine.write() = Some(player);
    Ok(())
}

fn play_local_at(mut app: Signal<NativeApp>, engine: Signal<Option<PlaybackEngine>>, index: usize) {
    let track = {
        let state = app.read();
        if !state.local_mode {
            return;
        }
        let Some(track) = state.local_tracks.get(index).cloned() else {
            return;
        };
        track
    };
    let Some(url) = url::Url::from_file_path(&track.path).ok() else {
        app.write().status = Some("Cannot create a file URL for this track.".to_owned());
        return;
    };
    let media = local_media(&track, index);
    {
        let mut state = app.write();
        state.local_index = Some(index);
        state.coordinator.load(media);
        state.artwork.clear_other_media(None);
        state.photo_data_url = None;
        state.queue = Some(QueueWindow {
            items: Vec::new(),
            offset: 0,
            total: state.local_tracks.len(),
            current_index: index,
            current_media_id: Some(MediaId::new(index as i64 + 1)),
            has_previous: index > 0,
            has_next: index + 1 < state.local_tracks.len(),
            revision: 0,
        });
        state.player_expanded = track.kind == LocalKind::Video;
    }
    trim_allocator();
    let sequence = app.read().coordinator.snapshot().sequence;
    let volume = app.read().settings.volume;
    let result = ensure_playback_engine(app, engine).and_then(|_| {
        engine
            .read()
            .as_ref()
            .ok_or_else(|| "GStreamer playback is unavailable".to_owned())
            .and_then(|player| {
                player
                    .open_local(&url)
                    .and_then(|_| player.play())
                    .map_err(|error| error.to_string())?;
                player.set_volume(volume);
                Ok(())
            })
    });
    match result {
        Ok(()) => {
            app.write().coordinator.loaded(sequence, 0.0);
            if let Some(mut timing) = app.read().timing_signal {
                timing.set(PlaybackTiming {
                    position: 0.0,
                    duration: track.duration.unwrap_or(0.0),
                });
            }
        }
        Err(error) => {
            app.write().coordinator.failed(sequence, &error);
            app.write().status = Some(format!("Local playback failed: {error}"));
        }
    }
}

fn navigate_local(
    app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
    forward: bool,
    from_eos: bool,
) {
    let state = app.read();
    let Some(index) = state.local_index else {
        return;
    };
    let len = state.local_tracks.len();
    let repeat = state.coordinator.snapshot().repeat;
    let position = state.coordinator.snapshot().position;
    drop(state);
    if !forward && !from_eos && position > 3.0 {
        seek(app, engine, 0.0);
        return;
    }
    let next = if from_eos && repeat == RepeatMode::One {
        index
    } else if forward && index + 1 < len {
        index + 1
    } else if !forward && index > 0 {
        index - 1
    } else if repeat == RepeatMode::Queue && len > 0 {
        if forward { 0 } else { len - 1 }
    } else {
        return;
    };
    play_local_at(app, engine, next);
}

fn begin_browse(mut app: Signal<NativeApp>) {
    if app.read().local_mode {
        return;
    }
    let Some(client) = app.read().client.clone() else {
        return;
    };
    let query = app.read().query();
    let generation = app.write().library.begin_query(query.clone());
    load_dashboard(app);
    spawn(async move {
        match client.browse(&query).await {
            Ok(page) => {
                let first = page.items.first().cloned();
                app.write().library.apply_page(generation, page, false);
                if let Some(media) = first {
                    ensure_artwork(app, media);
                }
            }
            Err(error) => {
                let failed = app.write().library.fail(generation);
                if failed {
                    app.write().status = Some(error.user_message());
                }
            }
        }
    });
}

fn load_dashboard(mut app: Signal<NativeApp>) {
    if app.read().local_mode {
        return;
    }
    let Some(client) = app.read().client.clone() else {
        return;
    };
    let query = DashboardQuery {
        liked: app.read().favorites_only,
        category_id: app.read().category_id,
        media_type: app.read().media_filter,
    };
    app.write().dashboard_generation += 1;
    app.write().dashboard = DashboardSummary::default();
    let generation = app.read().dashboard_generation;
    spawn(async move {
        if let Ok(summary) = client.dashboard(&query).await {
            let is_current = app.read().dashboard_generation == generation;
            if is_current {
                let featured = summary
                    .featured_id
                    .and_then(|id| summary.media.iter().find(|media| media.id == id).cloned());
                app.write().dashboard = summary;
                if let Some(media) = featured {
                    ensure_artwork(app, media);
                }
            }
        }
    });
}

fn featured_media(app: &NativeApp) -> Option<Media> {
    let featured_id = app.dashboard.featured_id;
    featured_id
        .and_then(|id| {
            app.library
                .items
                .iter()
                .chain(app.dashboard.media.iter())
                .find(|media| media.id == id)
                .cloned()
        })
        .or_else(|| app.library.items.first().cloned())
}

fn artwork_url(app: &NativeApp, media: &Media) -> Option<Arc<String>> {
    if app.local_mode {
        return None;
    }
    match app.artwork.get(media) {
        Some(ArtworkState::Ready(value)) => Some(Arc::clone(value)),
        _ => None,
    }
}

fn category_artwork_url(app: &NativeApp, category: &Category) -> Option<Arc<String>> {
    match app.artwork.get_category(category) {
        Some(ArtworkState::Ready(value)) => Some(Arc::clone(value)),
        _ => None,
    }
}

fn ensure_category_artwork(mut app: Signal<NativeApp>, category: Category) {
    if app.read().local_mode {
        return;
    }
    if category.cover_path.is_none() {
        return;
    }
    let Some(client) = app.read().client.clone() else {
        return;
    };
    let Some(key) = app.write().artwork.start_category(&category) else {
        return;
    };
    spawn(async move {
        let result = match client.category_thumbnail(category.id).await {
            Ok(bytes) => Some(ArtworkState::Ready(Arc::new(artwork_source_url(
                &key, bytes,
            )))),
            Err(ApiError::Http { status: 404, .. }) => Some(ArtworkState::Missing),
            Err(error) => {
                tracing::debug!(%error, category_id = %category.id, "category artwork request failed");
                None
            }
        };
        if let Some(state) = result {
            app.write().artwork.finish(key, state);
        } else {
            app.write().artwork.remove(&key);
        }
    });
}

fn ensure_artwork(mut app: Signal<NativeApp>, media: Media) {
    if app.read().local_mode {
        return;
    }
    // Immediately clear artwork data from any previous media so old data does not linger in memory
    app.write().artwork.clear_other_media(Some(&media));

    let Some(client) = app.read().client.clone() else {
        return;
    };
    let Some(key) = app.write().artwork.start(&media) else {
        return;
    };
    spawn(async move {
        let result = match client.media_thumbnail(media.id).await {
            Ok(bytes) => Some(ArtworkState::Ready(Arc::new(artwork_source_url(
                &key, bytes,
            )))),
            Err(ApiError::Http { status: 404, .. }) => Some(ArtworkState::Missing),
            Err(error) => {
                tracing::debug!(%error, media_id = %media.id, "artwork request failed");
                None
            }
        };
        if let Some(state) = result {
            app.write().artwork.finish(key, state);
        } else {
            app.write().artwork.remove(&key);
        }
    });
}

pub(crate) fn brand_mark_data_url() -> &'static str {
    static BRAND_MARK: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
        let bytes = include_bytes!("../../assets/brand-mark.png");
        let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
        format!("data:image/png;base64,{encoded}")
    });
    &BRAND_MARK
}

fn artwork_extension(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(b"\x89PNG") {
        "png"
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        "jpg"
    } else if bytes.starts_with(b"GIF8") {
        "gif"
    } else {
        "webp"
    }
}

fn artwork_file_url(key: &str, bytes: &[u8]) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let _ = (key, bytes);
        None
    }
    #[cfg(not(target_os = "windows"))]
    {
        let ext = artwork_extension(bytes);
        let path = artwork_cache_path(key, ext).ok()?;
        std::fs::write(&path, bytes).ok()?;
        url::Url::from_file_path(&path).ok().map(|u| u.to_string())
    }
}

fn artwork_source_url(key: &str, bytes: Vec<u8>) -> String {
    if let Some(file_url) = artwork_file_url(key, &bytes) {
        file_url
    } else {
        artwork_data_url(bytes)
    }
}

fn artwork_data_url(bytes: Vec<u8>) -> String {
    let mime = artwork_mime(&bytes);
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    format!("data:{mime};base64,{encoded}")
}

fn artwork_mime(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(b"\x89PNG") {
        "image/png"
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF8") {
        "image/gif"
    } else {
        "image/webp"
    }
}

fn load_more(mut app: Signal<NativeApp>) {
    if app.read().local_mode {
        return;
    }
    let Some((generation, query)) = app.write().library.next_page() else {
        return;
    };
    let Some(client) = app.read().client.clone() else {
        return;
    };
    spawn(async move {
        match client.browse(&query).await {
            Ok(page) => {
                app.write().library.apply_page(generation, page, true);
            }
            Err(error) => {
                let failed = app.write().library.fail(generation);
                if failed {
                    app.write().status = Some(error.user_message());
                }
            }
        }
    });
}

fn play_media(
    app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
    media: Media,
    auto_queue: bool,
) {
    play_media_at(app, engine, media, auto_queue, None, true, false);
}

fn play_media_at(
    mut app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
    media: Media,
    auto_queue: bool,
    resume_at: Option<f64>,
    autoplay: bool,
    takeover: bool,
) {
    if app.read().local_mode {
        return;
    }
    ensure_artwork(app, media.clone());
    if media.is_photo() {
        if takeover {
            app.write().session_takeover_pending = false;
        }
        play_photo(app, engine, media, auto_queue);
        return;
    }
    let client = app.read().client.clone();
    let Some(client) = client else {
        if takeover {
            app.write().session_takeover_pending = false;
        }
        return;
    };
    let previous_session = app.write().session.take();
    let previous = app.read().coordinator.snapshot().media.clone();
    let previous_position = engine
        .read()
        .as_ref()
        .and_then(PlaybackEngine::position)
        .unwrap_or(app.read().coordinator.snapshot().position);
    let previous_duration = engine
        .read()
        .as_ref()
        .and_then(PlaybackEngine::duration)
        .unwrap_or(app.read().coordinator.snapshot().duration);
    if let Some(engine) = engine.read().as_ref() {
        let _ = engine.pause();
    }
    app.write().coordinator.load(media.clone());
    if let Some(pos) = resume_at {
        app.write().coordinator.update_position(pos);
    }
    if media.is_video() && resume_at.is_none() {
        app.write().player_expanded = true;
    }
    let sequence = app.read().coordinator.snapshot().sequence;
    let quality = app.read().settings.quality;
    app.write().lyrics.clear();
    app.write().subtitles.clear();
    app.write().selected_subtitle = None;
    app.write().subtitle_cues.clear();
    app.write().photo_data_url = None;
    app.write().status = None;

    if let Some(previous) = previous
        && previous.id != media.id
    {
        let release_client = client.clone();
        let report_session = previous_session.clone();
        spawn(async move {
            send_report(
                &release_client,
                &previous,
                "pause",
                previous_position,
                previous_duration,
                report_session.as_ref(),
                ReportDelivery {
                    record_event: true,
                    socket_primary: false,
                },
            )
            .await;
        });
    }

    if auto_queue {
        auto_fill_queue(app, media.id);
    }
    load_extras(app, media.id);
    spawn(async move {
        if let Some(session) = previous_session {
            let _ = client.release(&session).await;
        }
        let resume = match resume_at {
            Some(position) => position,
            None => {
                let stored = client
                    .resume(media.id)
                    .await
                    .ok()
                    .and_then(|value| value.position)
                    .unwrap_or(0.0);
                let duration = media.duration.unwrap_or(0.0);
                if stored < 2.0 || (duration > 0.0 && stored >= duration - 3.0) {
                    0.0
                } else {
                    stored
                }
            }
        };
        let result = async {
            let session = client.create_playback_session(media.id, quality).await?;
            let stream = client.absolute_url(&session.stream_url)?;
            Ok::<_, ApiError>((session, stream))
        }
        .await;
        let (session, stream) = match result {
            Ok(value) => value,
            Err(error) => {
                let message = error.user_message();
                if error.is_playback_session_unavailable() {
                    apply_remote_holder(app, engine, &client, error.holder(), &message).await;
                    app.write().player_expanded = false;
                } else {
                    app.write().coordinator.failed(sequence, &message);
                }
                app.write().status = Some(message);
                if takeover {
                    app.write().session_takeover_pending = false;
                }
                return;
            }
        };
        let superseded = app.read().coordinator.snapshot().sequence != sequence;
        if superseded {
            let _ = client.release(&session).await;
            if takeover {
                app.write().session_takeover_pending = false;
            }
            return;
        }
        let ready = client.wait_for_stream_ready(&session).await;
        if app.read().coordinator.snapshot().sequence != sequence {
            let _ = client.release(&session).await;
            if takeover {
                app.write().session_takeover_pending = false;
            }
            return;
        }
        let started = match ready {
            Ok(()) => match ensure_playback_engine(app, engine) {
                Ok(()) => engine.read().as_ref().map(|engine| {
                    engine
                        .open(&session, &stream)
                        .and_then(|_| {
                            if autoplay {
                                engine.play()
                            } else {
                                engine.pause()
                            }
                        })
                        .map_err(|error| error.to_string())
                }),
                Err(error) => Some(Err(error)),
            },
            Err(error) => Some(Err(error.to_string())),
        };
        match started {
            Some(Ok(())) => {
                if let Some(engine) = engine.read().as_ref() {
                    if resume > 0.0 {
                        engine.seek(resume);
                    }
                    engine.set_volume(app.read().settings.volume);
                }
                app.write().session = Some(session.clone());
                if autoplay {
                    app.write().coordinator.loaded(sequence, resume);
                } else {
                    app.write().coordinator.loaded_paused(sequence, resume);
                }
                if takeover {
                    app.write().session_takeover_pending = false;
                }
                let socket_primary = app.read().socket_ready;
                send_report(
                    &client,
                    &media,
                    if autoplay { "play" } else { "pause" },
                    resume,
                    media.duration.unwrap_or(0.0),
                    Some(&session),
                    ReportDelivery {
                        record_event: true,
                        socket_primary,
                    },
                )
                .await;
            }
            Some(Err(error)) => {
                let message = error.to_string();
                app.write().coordinator.failed(sequence, &message);
                app.write().status = Some(message);
                if takeover {
                    app.write().session_takeover_pending = false;
                }
                let _ = client.release(&session).await;
            }
            None => {
                app.write()
                    .coordinator
                    .failed(sequence, "GStreamer playback is unavailable");
                app.write().status = Some("GStreamer playback is unavailable.".to_owned());
                if takeover {
                    app.write().session_takeover_pending = false;
                }
                let _ = client.release(&session).await;
            }
        }
    });
}

fn play_photo(
    mut app: Signal<NativeApp>,
    mut engine: Signal<Option<PlaybackEngine>>,
    media: Media,
    auto_queue: bool,
) {
    if app.read().local_mode {
        return;
    }
    ensure_artwork(app, media.clone());
    let Some(client) = app.read().client.clone() else {
        return;
    };
    let previous_session = app.write().session.take();
    let previous = app.read().coordinator.snapshot().media.clone();
    let position = app.read().coordinator.snapshot().position;
    let duration = app.read().coordinator.snapshot().duration;
    // Drop the entire playbin after Stop. GStreamer can keep decoder/source
    // graphs reachable on a persistent playbin even after it reaches Null;
    // constructing a fresh engine on the next playback releases that graph.
    if let Some(current_engine) = engine.write().take() {
        let _ = current_engine.stop();
    }
    app.read().video_frames.clear();
    app.write().coordinator.load(media.clone());
    let sequence = app.read().coordinator.snapshot().sequence;
    app.write().photo_data_url = None;
    app.write().lyrics.clear();
    app.write().subtitles.clear();
    app.write().selected_subtitle = None;
    app.write().subtitle_cues.clear();
    app.write().player_expanded = true;
    app.write().queue_open = false;
    app.write().status = None;
    if auto_queue {
        auto_fill_queue(app, media.id);
    }
    load_extras(app, media.id);
    spawn(async move {
        if let Some(previous) = previous {
            send_report(
                &client,
                &previous,
                "pause",
                position,
                duration,
                previous_session.as_ref(),
                ReportDelivery {
                    record_event: true,
                    socket_primary: false,
                },
            )
            .await;
        }
        if let Some(session) = previous_session {
            let _ = client.release(&session).await;
        }
        match client.photo(media.id).await {
            Ok(bytes) => {
                let current = app.read().coordinator.snapshot().sequence == sequence;
                if current {
                    let mime = media.mime_type.as_deref().unwrap_or("image/jpeg");
                    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
                    app.write().photo_data_url =
                        Some(Arc::new(format!("data:{mime};base64,{encoded}")));
                    app.write().coordinator.loaded(sequence, 0.0);
                }
            }
            Err(error) => {
                app.write()
                    .coordinator
                    .failed(sequence, error.user_message());
                app.write().status = Some(error.user_message());
            }
        }
    });
}

fn change_quality(
    mut app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
    quality: Quality,
) {
    if app.read().local_mode {
        return;
    }
    if app.read().coordinator.snapshot().session_unavailable {
        return;
    }
    if app.read().coordinator.snapshot().quality == quality {
        return;
    }
    let was_playing = app.read().coordinator.snapshot().status == PlaybackStatus::Playing
        || engine
            .read()
            .as_ref()
            .is_some_and(PlaybackEngine::is_playing);
    let media = app.read().coordinator.snapshot().media.clone();
    let position = engine
        .read()
        .as_ref()
        .and_then(PlaybackEngine::position)
        .unwrap_or(app.read().coordinator.snapshot().position);
    app.write().coordinator.set_quality(quality);
    app.write().settings.quality = quality;
    {
        let model = app.read();
        if let Err(error) = model.store.save(&model.settings) {
            drop(model);
            app.write().status = Some(error.to_string());
            return;
        }
    }
    if let Some(media) = media {
        play_media_at(
            app,
            engine,
            media,
            false,
            Some(position),
            was_playing,
            false,
        );
    }
}

fn tick_playback(mut app: Signal<NativeApp>, engine: Signal<Option<PlaybackEngine>>) {
    let app_read = app.read();
    let snapshot = app_read.coordinator.snapshot().clone();
    drop(app_read);
    if snapshot.session_unavailable
        || snapshot.media.is_none()
        || snapshot.status == PlaybackStatus::Ended
    {
        return;
    }
    if snapshot.status == PlaybackStatus::Loading {
        if engine
            .read()
            .as_ref()
            .is_some_and(PlaybackEngine::is_playing)
        {
            app.write().coordinator.play();
        } else {
            return;
        }
    } else if snapshot.status == PlaybackStatus::Paused
        && engine
            .read()
            .as_ref()
            .is_some_and(PlaybackEngine::is_playing)
    {
        app.write().coordinator.play();
    }
    let event = engine.read().as_ref().and_then(PlaybackEngine::poll_event);
    let position = engine.read().as_ref().and_then(PlaybackEngine::position);
    let duration = engine.read().as_ref().and_then(PlaybackEngine::duration);

    let effective_duration = duration
        .filter(|&d| d > 0.0)
        .or_else(|| snapshot.media.as_ref().and_then(|m| m.duration))
        .or(if snapshot.duration > 0.0 {
            Some(snapshot.duration)
        } else {
            None
        });

    let is_ended = matches!(event, Some(EngineEvent::Ended))
        || (snapshot.status == PlaybackStatus::Playing
            && position.is_some()
            && effective_duration.is_some()
            && effective_duration.unwrap_or(0.0) > 1.0
            && position.unwrap_or(0.0) >= effective_duration.unwrap_or(0.0) - 0.25);

    if is_ended {
        app.write().coordinator.ended();
        navigate_queue(app, engine, true, true);
        return;
    }

    if let Some(EngineEvent::Failed(error)) = event {
        let sequence = snapshot.sequence;
        app.write().coordinator.failed(sequence, &error);
        app.write().status = Some(format!("Playback failed: {error}"));
        return;
    }

    if let Some(position) = position {
        let duration = effective_duration.unwrap_or(position);
        // Read-only pre-check: taking a write guard marks the whole
        // app signal dirty (full re-render). Instead, update NativeApp
        // timing silently and publish to dedicated timing_signal listeners.
        let changed = app.read().coordinator.timing_changed(position, duration);
        if changed {
            #[allow(deprecated)]
            app.write_silent()
                .coordinator
                .update_timing(position, duration);
            if let Some(mut timing) = app.read().timing_signal {
                let current_timing = *timing.read();
                let ui_changed = (current_timing.position - position).abs() >= 1.0
                    || (current_timing.duration - duration).abs() >= 1.0;
                if ui_changed {
                    timing.set(PlaybackTiming { position, duration });
                    trim_allocator();
                }
            }
        }
    }
    if app.read().local_mode {
        let index = app.read().local_index;
        if let (Some(index), Some(duration)) = (index, duration.filter(|value| *value > 0.0)) {
            let stale = app.read().local_tracks.get(index).is_some_and(|track| {
                track
                    .duration
                    .is_none_or(|previous| (previous - duration).abs() > 0.5)
            });
            if stale && let Some(track) = app.write().local_tracks.get_mut(index) {
                track.duration = Some(duration);
            }
        }
    }
    publish_socket_state(app);
}

fn publish_socket_state(mut app: Signal<NativeApp>) {
    if app.read().local_mode {
        return;
    }
    let current = app.read();
    if !current.socket_ready {
        return;
    }
    let Some(sender) = current.socket_sender.clone() else {
        return;
    };
    let Some(session) = current.session.clone().filter(|value| value.lease_required) else {
        return;
    };
    let snapshot = current.coordinator.snapshot().clone();
    let Some(media) = snapshot.media else {
        return;
    };
    let session_id = session.session_id.as_str().to_owned();
    let action = if snapshot.status == PlaybackStatus::Playing {
        "play"
    } else {
        "pause"
    };
    let loop_mode = match snapshot.repeat {
        RepeatMode::None => "none",
        RepeatMode::One => "media",
        RepeatMode::Queue => "queue",
    };
    let signature = format!(
        "{session_id}:{}:{action}:{loop_mode}:{}",
        media.id.get(),
        snapshot.shuffle
    );
    let changed = current.socket_last_signature.as_ref() != Some(&signature);
    let due = current
        .socket_last_report_at
        .is_none_or(|last| last.elapsed() >= std::time::Duration::from_secs(1));
    let needs_bind = current.socket_session_id.as_ref() != Some(&session_id);
    drop(current);
    if needs_bind {
        if sender
            .try_send(SocketCommand::Bind {
                version: 1,
                session_id: session_id.clone(),
            })
            .is_err()
        {
            return;
        }
        let mut state = app.write();
        state.socket_session_id = Some(session_id.clone());
        state.socket_sequence = 0;
    }
    if !changed && !(action == "play" && due) && !needs_bind {
        return;
    }
    let sequence = app.read().socket_sequence + 1;
    let command = SocketCommand::State {
        version: 1,
        session_id,
        media_id: media.id.get(),
        action: action.to_owned(),
        position: snapshot.position.max(0.0),
        duration: snapshot.duration.max(0.0),
        loop_mode: loop_mode.to_owned(),
        shuffle_enabled: snapshot.shuffle,
        sequence,
    };
    if sender.try_send(command).is_ok() {
        let mut state = app.write();
        state.socket_sequence = sequence;
        state.socket_last_signature = Some(signature);
        state.socket_last_report_at = Some(Instant::now());
    }
}

fn heartbeat(mut app: Signal<NativeApp>, engine: Signal<Option<PlaybackEngine>>) {
    if app.read().local_mode {
        return;
    }
    let Some(client) = app.read().client.clone() else {
        return;
    };
    let session = app.read().session.clone();
    let observing_remote = app.read().coordinator.snapshot().session_unavailable;
    if session.is_none() && observing_remote {
        spawn(async move {
            if let Ok(status) = client.playback_lease().await {
                let still_observing = {
                    let state = app.read();
                    !state.local_mode
                        && !state.socket_ready
                        && state.session.is_none()
                        && state.coordinator.snapshot().session_unavailable
                };
                if !still_observing {
                    return;
                }
                if status.state == "busy" {
                    apply_remote_holder(
                        app,
                        engine,
                        &client,
                        status.active_session,
                        "Playback is active elsewhere",
                    )
                    .await;
                } else if status.state == "available" && !app.read().session_takeover_pending {
                    app.write().coordinator.remote_available();
                }
            }
        });
        return;
    }
    let (Some(session), Some(media)) = (session, app.read().coordinator.snapshot().media.clone())
    else {
        return;
    };
    let position = engine
        .read()
        .as_ref()
        .and_then(PlaybackEngine::position)
        .unwrap_or(app.read().coordinator.snapshot().position);
    let duration = engine
        .read()
        .as_ref()
        .and_then(PlaybackEngine::duration)
        .unwrap_or(app.read().coordinator.snapshot().duration);
    let status = app.read().coordinator.snapshot().status;
    spawn(async move {
        if session.lease_required
            && let Err(error) = client.heartbeat(&session).await
        {
            if app.read().local_mode {
                return;
            }
            if let Some(engine) = engine.read().as_ref() {
                let _ = engine.stop();
            }
            let message = error.user_message();
            if error.is_playback_session_unavailable() {
                apply_remote_holder(app, engine, &client, error.holder(), &message).await;
                app.write().player_expanded = false;
                app.write().quality_popover_open = false;
            } else {
                app.write().coordinator.lease_lost();
            }
            app.write().status = Some(message);
            return;
        }
        if app.read().local_mode {
            return;
        }
        let action = if status == PlaybackStatus::Playing {
            "play"
        } else {
            "pause"
        };
        send_report(
            &client,
            &media,
            action,
            position,
            duration,
            Some(&session),
            ReportDelivery {
                record_event: false,
                socket_primary: false,
            },
        )
        .await;
    });
}

async fn apply_remote_holder(
    mut app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
    client: &ApiClient,
    holder: Option<SessionHolder>,
    message: &str,
) {
    let previous_revision = app.read().socket_last_revision;
    let was_observing = app.read().coordinator.snapshot().session_unavailable;
    if app.read().local_mode {
        return;
    }
    if !app.read().coordinator.snapshot().session_unavailable
        && let Some(engine) = engine.read().as_ref()
    {
        let _ = engine.stop();
    }
    app.write().session = None;
    if let Some(holder) = holder.clone()
        && let Some(media_id) = holder.media_id
        && let Ok(media) = client.media(media_id).await
    {
        let current = app.read();
        let superseded = current.local_mode
            || current.session.is_some()
            || current.socket_last_revision != previous_revision
            || (was_observing && !current.coordinator.snapshot().session_unavailable);
        drop(current);
        if superseded {
            return;
        }
        ensure_artwork(app, media.clone());
        app.write().coordinator.observe_remote(media, holder);
        return;
    }
    let current = app.read();
    let superseded = current.local_mode
        || current.session.is_some()
        || current.socket_last_revision != previous_revision
        || (was_observing && !current.coordinator.snapshot().session_unavailable);
    drop(current);
    if superseded {
        return;
    }
    app.write().coordinator.session_unavailable(message);
    app.write().coordinator.set_holder(holder);
}

fn toggle_playback(app: Signal<NativeApp>, engine: Signal<Option<PlaybackEngine>>) {
    let requested_playing = app.read().coordinator.snapshot().status != PlaybackStatus::Playing;
    set_playback_playing(app, engine, requested_playing);
}

fn set_playback_playing(
    mut app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
    requested_playing: bool,
) {
    if app.read().coordinator.snapshot().session_unavailable {
        return;
    }
    let Some(media) = app.read().coordinator.snapshot().media.clone() else {
        return;
    };
    if app.read().local_mode {
        let playing = app.read().coordinator.snapshot().status == PlaybackStatus::Playing;
        if playing != requested_playing {
            let result = engine.read().as_ref().map(|player| {
                if requested_playing {
                    player.play()
                } else {
                    player.pause()
                }
            });
            if matches!(result, Some(Ok(()))) {
                if requested_playing {
                    app.write().coordinator.play();
                } else {
                    app.write().coordinator.pause();
                }
            }
        }
        return;
    }
    let Some(client) = app.read().client.clone() else {
        return;
    };
    let session = app.read().session.clone();
    let playing = app.read().coordinator.snapshot().status == PlaybackStatus::Playing;
    if playing == requested_playing {
        return;
    }
    let result = engine.read().as_ref().map(|engine| {
        if requested_playing {
            engine.play()
        } else {
            engine.pause()
        }
    });
    if matches!(result, Some(Ok(()))) {
        if requested_playing {
            app.write().coordinator.play();
        } else {
            app.write().coordinator.pause();
        }
        let position = app.read().coordinator.snapshot().position;
        let duration = app.read().coordinator.snapshot().duration;
        let socket_primary = app.read().socket_ready;
        spawn(async move {
            send_report(
                &client,
                &media,
                if requested_playing { "play" } else { "pause" },
                position,
                duration,
                session.as_ref(),
                ReportDelivery {
                    record_event: true,
                    socket_primary,
                },
            )
            .await;
        });
    }
}

fn take_over_playback(mut app: Signal<NativeApp>, engine: Signal<Option<PlaybackEngine>>) {
    if app.read().local_mode {
        return;
    }
    if app.read().session_takeover_pending {
        return;
    }
    let Some(client) = app.read().client.clone() else {
        return;
    };
    let Some(media) = app.read().coordinator.snapshot().media.clone() else {
        return;
    };
    let position = app.read().coordinator.snapshot().position;
    app.write().session_takeover_pending = true;
    app.write().status = None;

    // Releasing the lease pushes "available" before this request completes. That
    // can unmount PlayerBar, so the takeover task must outlive its button.
    dioxus_core::spawn_forever(async move {
        match client.force_release_playback_lease().await {
            Ok(()) => {
                play_media_at(app, engine, media, false, Some(position), true, true);
            }
            Err(error) => {
                app.write().session_takeover_pending = false;
                app.write().status = Some(error.user_message());
            }
        }
    });
}

fn handle_mpris_command(
    app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
    command: MprisCommand,
) {
    match command {
        MprisCommand::SetPlaying(playing) => set_playback_playing(app, engine, playing),
        MprisCommand::Toggle => toggle_playback(app, engine),
        MprisCommand::Previous => navigate_queue(app, engine, false, false),
        MprisCommand::Next => navigate_queue(app, engine, true, false),
    }
}

fn publish_mpris_state(
    app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
    mpris: &MprisBridge,
) {
    let model = app.read();
    let state = MprisState::from_playback(
        model.coordinator.snapshot(),
        model.queue.as_ref(),
        model.settings.volume,
        engine.read().is_some(),
    );
    drop(model);
    mpris.publish(state);
}

fn stop_playback(mut app: Signal<NativeApp>, engine: Signal<Option<PlaybackEngine>>) {
    let local_mode = app.read().local_mode;
    let client = app.read().client.clone();
    let session = app.write().session.take();
    let media = app.read().coordinator.snapshot().media.clone();
    let position = app.read().coordinator.snapshot().position;
    let duration = app.read().coordinator.snapshot().duration;
    let mut engine = engine;
    if let Some(current_engine) = engine.write().take() {
        let _ = current_engine.stop();
    }
    app.read().video_frames.clear();
    app.write().coordinator.stop();
    if let Some(mut timing) = app.read().timing_signal {
        timing.set(PlaybackTiming {
            position: 0.0,
            duration: 0.0,
        });
    }
    // Thumbnail responses are held as base64 data URLs in the native signal.
    // Release them with the playback session so repeated connected playback
    // cannot retain every album/track artwork until the process exits.
    app.write().artwork.clear_all();
    app.write().photo_data_url = None;
    app.write().lyrics.clear();
    app.write().subtitles.clear();
    app.write().selected_subtitle = None;
    app.write().subtitle_cues.clear();
    app.write().player_expanded = false;
    app.write().queue_open = false;
    if let Some(client) = client.filter(|_| !local_mode) {
        spawn(async move {
            if let Some(media) = media {
                send_report(
                    &client,
                    &media,
                    "pause",
                    position,
                    duration,
                    session.as_ref(),
                    ReportDelivery {
                        record_event: true,
                        socket_primary: false,
                    },
                )
                .await;
            }
            if let Some(session) = session {
                let _ = client.release(&session).await;
            }
        });
    }
}

fn seek(mut app: Signal<NativeApp>, engine: Signal<Option<PlaybackEngine>>, position: f64) {
    if app.read().coordinator.snapshot().session_unavailable {
        return;
    }
    if let Some(engine) = engine.read().as_ref() {
        engine.seek(position);
    }
    app.write().coordinator.update_position(position);
    if let Some(mut timing) = app.read().timing_signal {
        let dur = app.read().coordinator.snapshot().duration;
        timing.set(PlaybackTiming {
            position,
            duration: dur,
        });
    }
}

fn skip_seconds(app: Signal<NativeApp>, engine: Signal<Option<PlaybackEngine>>, offset: f64) {
    let app_ref = app.read();
    let playback = app_ref.coordinator.snapshot();
    let duration = playback.duration.max(playback.position);
    let target = (playback.position + offset).clamp(0.0, duration.max(0.0));
    drop(app_ref);
    seek(app, engine, target);
}

fn set_volume(mut app: Signal<NativeApp>, engine: Signal<Option<PlaybackEngine>>, value: f64) {
    let volume = Volume::new(value);
    app.write().settings.volume = volume;
    if let Some(engine) = engine.read().as_ref() {
        engine.set_volume(volume);
    }
    let model = app.read();
    if let Err(error) = model.store.save(&model.settings) {
        drop(model);
        app.write().status = Some(error.to_string());
    }
}

fn toggle_mute(app: Signal<NativeApp>, engine: Signal<Option<PlaybackEngine>>) {
    let current = app.read().settings.volume.get();
    if current > 0.0 {
        set_volume(app, engine, 0.0);
    } else {
        set_volume(app, engine, 0.75);
    }
}

fn toggle_repeat(mut app: Signal<NativeApp>) {
    if app.read().coordinator.snapshot().session_unavailable {
        return;
    }
    let current = app.read().coordinator.snapshot().repeat;
    let next = match current {
        RepeatMode::None => RepeatMode::Queue,
        RepeatMode::Queue => RepeatMode::One,
        RepeatMode::One => RepeatMode::None,
    };
    app.write().coordinator.set_repeat(next);
}

fn toggle_shuffle(mut app: Signal<NativeApp>) {
    if app.read().local_mode {
        return;
    }
    if app.read().coordinator.snapshot().session_unavailable {
        return;
    }
    let current = app.read().coordinator.snapshot().shuffle;
    let next = !current;
    app.write().coordinator.set_shuffle(next);
    if next {
        queue_shuffle(app);
    }
}

fn load_queue(mut app: Signal<NativeApp>) {
    if app.read().local_mode {
        return;
    }
    let Some(client) = app.read().client.clone() else {
        return;
    };
    spawn(async move {
        let result = client.queue_window().await;
        if app.read().local_mode {
            return;
        }
        match result {
            Ok(queue) => app.write().queue = Some(queue),
            Err(error) => app.write().status = Some(error.user_message()),
        }
    });
}

fn auto_fill_queue(app: Signal<NativeApp>, media_id: MediaId) {
    if app.read().local_mode {
        return;
    }
    let Some(client) = app.read().client.clone() else {
        return;
    };
    let category_id = app.read().category_id;
    let liked = app.read().favorites_only;
    spawn(async move {
        let result = if let Some(category_id) = category_id {
            client.queue_auto_category(category_id, media_id).await
        } else if liked {
            client.queue_auto_likes(Some(media_id)).await
        } else {
            client.queue_auto_all(Some(media_id)).await
        };
        if let Err(error) = result {
            tracing::debug!(%error, "queue auto-fill failed");
        }
        load_queue(app);
    });
}

/// Replace the queue with all folder audio in `category_id` (including
/// subfolders) ordered by track number and immediately play the first track.
pub(crate) fn play_folder(
    mut app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
    category_id: CategoryId,
) {
    if app.read().local_mode {
        return;
    }
    let Some(client) = app.read().client.clone() else {
        return;
    };
    spawn(async move {
        let result = async {
            let queue = client.queue_play_folder(category_id).await?;
            let first_id = queue.current_media_id.ok_or(ApiError::QueueEmpty)?;
            client.media(first_id).await
        }
        .await;
        match result {
            Ok(media) => {
                play_media(app, engine, media, false);
                load_queue(app);
            }
            Err(ApiError::QueueEmpty) => {
                app.write().status = Some("No playable audio in this folder.".to_owned());
            }
            Err(error) => {
                app.write().status = Some(error.user_message());
            }
        }
    });
}

/// Append all folder audio in `category_id` (including subfolders) to the end
/// of the existing queue, skipping tracks that are already queued.
fn append_folder(mut app: Signal<NativeApp>, category_id: CategoryId, category_name: String) {
    if app.read().local_mode {
        return;
    }
    let Some(client) = app.read().client.clone() else {
        return;
    };
    app.write().status = None;
    spawn(async move {
        match client.queue_append_folder(category_id).await {
            Ok(result) => {
                load_queue(app);
                if result.added_count > 0 {
                    let plural = if result.added_count == 1 { "" } else { "s" };
                    app.write().status = Some(format!(
                        "{} track{} from “{category_name}” added to queue.",
                        result.added_count, plural
                    ));
                } else {
                    app.write().status = Some(format!(
                        "All tracks from “{category_name}” are already in the queue."
                    ));
                }
            }
            Err(ApiError::QueueEmpty) => {
                app.write().status = Some("No playable audio in this folder.".to_owned());
            }
            Err(error) => {
                app.write().status = Some(error.user_message());
            }
        }
    });
}

fn select_queue(app: Signal<NativeApp>, engine: Signal<Option<PlaybackEngine>>, id: MediaId) {
    if app.read().local_mode {
        return;
    }
    let Some(client) = app.read().client.clone() else {
        return;
    };
    spawn(async move {
        let result = async {
            client.queue_select(id).await?;
            client.media(id).await
        }
        .await;
        match result {
            Ok(media) => {
                play_media(app, engine, media, false);
                load_queue(app);
            }
            Err(error) => {
                let mut app = app;
                app.write().status = Some(error.user_message());
            }
        }
    });
}

fn navigate_queue(
    app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
    forward: bool,
    from_eos: bool,
) {
    if app.read().local_mode {
        navigate_local(app, engine, forward, from_eos);
        return;
    }
    if app.read().coordinator.snapshot().session_unavailable {
        return;
    }
    let app_read = app.read();
    let playback = app_read.coordinator.snapshot().clone();
    let current_media = playback.media.clone();
    let repeat = playback.repeat;
    let position = playback.position;
    let client = app_read.client.clone();
    drop(app_read);

    // Loop current media if RepeatMode::One and triggered by EOS
    if from_eos
        && repeat == RepeatMode::One
        && let Some(media) = current_media
    {
        play_media_at(app, engine, media, false, Some(0.0), true, false);
        return;
    }

    if !forward && !from_eos && position > 3.0 {
        seek(app, engine, 0.0);
        return;
    }

    let Some(client) = client else {
        return;
    };

    spawn(async move {
        let current_id = current_media.as_ref().map(|m| m.id);
        let result = async {
            let selection = client.queue_navigate(forward).await?;
            let id = selection.media_id.ok_or(ApiError::QueueEmpty)?;

            // When navigating and server returned the same media (reached boundary of queue)
            if Some(id) == current_id {
                match repeat {
                    RepeatMode::Queue => {
                        if forward {
                            // Loop queue forward: wrap around to first item
                            let window = client.queue_window_at(0, 1).await?;
                            let first_id = window
                                .items
                                .first()
                                .map(|item| item.media.id)
                                .ok_or(ApiError::QueueEmpty)?;
                            client.queue_select(first_id).await?;
                            client.media(first_id).await
                        } else {
                            // Loop queue backward: wrap around to last item
                            let initial = client.queue_window_at(0, 1).await?;
                            let last_offset = initial.total.saturating_sub(1);
                            let window = client.queue_window_at(last_offset, 1).await?;
                            let last_id = window
                                .items
                                .last()
                                .map(|item| item.media.id)
                                .ok_or(ApiError::QueueEmpty)?;
                            client.queue_select(last_id).await?;
                            client.media(last_id).await
                        }
                    }
                    _ => {
                        // No loop: stop playback at boundary
                        Err(ApiError::QueueEmpty)
                    }
                }
            } else {
                client.media(id).await
            }
        }
        .await;

        if app.read().local_mode {
            return;
        }

        match result {
            Ok(media) => {
                play_media(app, engine, media, false);
                load_queue(app);
            }
            Err(error) => {
                if from_eos {
                    stop_playback(app, engine);
                } else if !matches!(error, ApiError::QueueEmpty) {
                    let mut app = app;
                    app.write().status = Some(error.user_message());
                }
            }
        }
    });
}

fn queue_shuffle(app: Signal<NativeApp>) {
    if app.read().local_mode {
        return;
    }
    let Some(client) = app.read().client.clone() else {
        return;
    };
    spawn(async move {
        if let Err(error) = client.queue_shuffle().await {
            let mut app = app;
            app.write().status = Some(error.user_message());
        }
        load_queue(app);
    });
}

fn queue_clear(app: Signal<NativeApp>) {
    if app.read().local_mode {
        return;
    }
    let Some(client) = app.read().client.clone() else {
        return;
    };
    spawn(async move {
        if let Err(error) = client.queue_clear().await {
            let mut app = app;
            app.write().status = Some(error.user_message());
        }
        load_queue(app);
    });
}

fn queue_remove(app: Signal<NativeApp>, id: MediaId) {
    if app.read().local_mode {
        return;
    }
    let Some(client) = app.read().client.clone() else {
        return;
    };
    spawn(async move {
        if let Err(error) = client.queue_remove(id).await {
            let mut app = app;
            app.write().status = Some(error.user_message());
        }
        load_queue(app);
    });
}

fn queue_reorder(mut app: Signal<NativeApp>, reordered_ids: Vec<MediaId>) {
    if app.read().local_mode {
        return;
    }
    let Some(client) = app.read().client.clone() else {
        return;
    };
    let Some(queue) = app.read().queue.clone() else {
        return;
    };

    // Optimistically reorder queue items locally
    {
        let mut app_write = app.write();
        if let Some(q) = app_write.queue.as_mut() {
            let mut map: HashMap<MediaId, QueueItem> = q
                .items
                .drain(..)
                .map(|item| (item.media.id, item))
                .collect();
            for id in &reordered_ids {
                if let Some(item) = map.remove(id) {
                    q.items.push(item);
                }
            }
            for (_, item) in map {
                q.items.push(item);
            }
        }
    }

    spawn(async move {
        let order = QueueOrder {
            offset: queue.offset,
            revision: queue.revision,
            media_ids: &reordered_ids,
        };
        match client.queue_reorder(&order).await {
            Ok(result) => {
                let mut app = app;
                if let Some(q) = app.write().queue.as_mut() {
                    q.revision = result.revision;
                    q.total = result.total;
                    q.current_index = result.current_index;
                    q.current_media_id = result.current_media_id;
                }
                load_queue(app);
            }
            Err(error) => {
                let mut app = app;
                app.write().status = Some(error.user_message());
                load_queue(app);
            }
        }
    });
}

fn add_media_to_queue(app: Signal<NativeApp>, id: MediaId, next: bool) {
    if app.read().local_mode {
        return;
    }
    let Some(client) = app.read().client.clone() else {
        return;
    };
    spawn(async move {
        if let Err(error) = client.queue_add(id, next).await {
            let mut app = app;
            app.write().status = Some(error.user_message());
        }
        load_queue(app);
    });
}

fn set_favorite(mut app: Signal<NativeApp>, liked: bool) {
    if app.read().local_mode {
        return;
    }
    let Some(media) = app.read().coordinator.snapshot().media.clone() else {
        return;
    };
    if !media.is_audio() {
        app.write().status = Some("Only audio items can be favorited.".to_owned());
        return;
    }
    let Some(client) = app.read().client.clone() else {
        return;
    };
    app.write().coordinator.set_liked(liked);
    if let Some(item) = app
        .write()
        .library
        .items
        .iter_mut()
        .find(|item| item.id == media.id)
    {
        item.liked = liked;
    }
    spawn(async move {
        if let Err(error) = client.set_favorite(media.id, liked).await {
            app.write().status = Some(error.user_message());
        }
    });
}

fn set_media_favorite(mut app: Signal<NativeApp>, media: Media, liked: bool) {
    if app.read().local_mode {
        return;
    }
    if !media.is_audio() {
        return;
    }
    let Some(client) = app.read().client.clone() else {
        return;
    };
    let is_current_media = app
        .read()
        .coordinator
        .snapshot()
        .media
        .as_ref()
        .is_some_and(|current| current.id == media.id);
    if is_current_media {
        app.write().coordinator.set_liked(liked);
    }
    if let Some(item) = app
        .write()
        .library
        .items
        .iter_mut()
        .find(|item| item.id == media.id)
    {
        item.liked = liked;
    }
    spawn(async move {
        if let Err(error) = client.set_favorite(media.id, liked).await {
            app.write().status = Some(error.user_message());
        }
    });
}

fn load_extras(app: Signal<NativeApp>, media_id: MediaId) {
    if app.read().local_mode {
        return;
    }
    let Some(client) = app.read().client.clone() else {
        return;
    };
    spawn(async move {
        let lyrics = client
            .lyrics(media_id)
            .await
            .ok()
            .flatten()
            .map(|lyrics| {
                lyrics
                    .segments
                    .into_iter()
                    .map(|segment| segment.text)
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_default();
        let subtitles = client.subtitles(media_id).await.unwrap_or_default();
        apply_extras_if_current(app, media_id, lyrics, subtitles);
    });
}

fn apply_extras_if_current(
    mut app: Signal<NativeApp>,
    media_id: MediaId,
    lyrics: String,
    subtitles: Vec<SubtitleTrack>,
) {
    if app.read().local_mode {
        return;
    }
    let still_current = app
        .read()
        .coordinator
        .snapshot()
        .media
        .as_ref()
        .is_some_and(|media| media.id == media_id);
    if still_current {
        let mut state = app.write();
        state.lyrics = lyrics;
        state.subtitles = subtitles;
    }
}

fn change_subtitle(
    mut app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
    index: Option<usize>,
) {
    app.write().selected_subtitle = index;
    app.write().subtitle_cues.clear();
    if let Some(engine) = engine.read().as_ref() {
        // Keep subtitle presentation in the native RSX layer instead of
        // compositing it into the decoded RGBA texture.
        engine.set_subtitle_uri(None);
    }
    let Some(index) = index else {
        return;
    };
    let (Some(track), Some(media_id), Some(client)) = (
        app.read().subtitles.get(index).cloned(),
        app.read()
            .coordinator
            .snapshot()
            .media
            .as_ref()
            .map(|media| media.id),
        app.read().client.clone(),
    ) else {
        return;
    };
    spawn(async move {
        let result = async {
            let bytes = client.subtitle_file(&track.vtt_url).await?;
            parse_webvtt(&bytes)
        }
        .await;
        match result {
            Ok(cues) => {
                let still_selected = app.read().selected_subtitle == Some(index)
                    && app
                        .read()
                        .coordinator
                        .snapshot()
                        .media
                        .as_ref()
                        .is_some_and(|media| media.id == media_id);
                if still_selected {
                    app.write().subtitle_cues = cues;
                }
            }
            Err(error) => {
                let still_selected = app.read().selected_subtitle == Some(index);
                if still_selected {
                    app.write().status = Some(error.user_message());
                }
            }
        }
    });
}

fn parse_webvtt(bytes: &[u8]) -> Result<Vec<SubtitleCue>, ApiError> {
    let source = std::str::from_utf8(bytes)
        .map_err(|_| ApiError::Malformed("Subtitle file is not valid UTF-8.".into()))?;
    let normalized = source.replace("\r\n", "\n").replace('\r', "\n");
    let mut cues = Vec::new();

    for block in normalized.split("\n\n") {
        let mut lines = block.lines().map(str::trim).filter(|line| !line.is_empty());
        let Some(mut timing) = lines.next() else {
            continue;
        };
        if timing.eq_ignore_ascii_case("WEBVTT")
            || timing.starts_with("NOTE")
            || timing.starts_with("STYLE")
            || timing.starts_with("REGION")
        {
            continue;
        }
        if !timing.contains("-->") {
            let Some(next) = lines.next() else {
                continue;
            };
            timing = next;
        }
        let Some((start, end_and_settings)) = timing.split_once("-->") else {
            continue;
        };
        let Some(end) = end_and_settings.split_whitespace().next() else {
            continue;
        };
        let (Some(start), Some(end)) = (
            parse_webvtt_timestamp(start.trim()),
            parse_webvtt_timestamp(end),
        ) else {
            continue;
        };
        if end <= start {
            continue;
        }
        let text = strip_webvtt_markup(&lines.collect::<Vec<_>>().join("\n"));
        if !text.is_empty() {
            cues.push(SubtitleCue { start, end, text });
        }
    }
    cues.sort_by(|left, right| left.start.total_cmp(&right.start));
    Ok(cues)
}

fn parse_webvtt_timestamp(value: &str) -> Option<f64> {
    let fields = value.split(':').collect::<Vec<_>>();
    let (hours, minutes, seconds) = match fields.as_slice() {
        [minutes, seconds] => (0.0, minutes.parse::<f64>().ok()?, seconds),
        [hours, minutes, seconds] => (
            hours.parse::<f64>().ok()?,
            minutes.parse::<f64>().ok()?,
            seconds,
        ),
        _ => return None,
    };
    let seconds = seconds.replace(',', ".").parse::<f64>().ok()?;
    Some(hours * 3600.0 + minutes * 60.0 + seconds)
}

fn strip_webvtt_markup(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut inside_tag = false;
    for character in value.chars() {
        match character {
            '<' => inside_tag = true,
            '>' => inside_tag = false,
            _ if !inside_tag => output.push(character),
            _ => {}
        }
    }
    output
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
        .trim()
        .to_owned()
}

struct ReportDelivery {
    record_event: bool,
    socket_primary: bool,
}

async fn send_report(
    client: &ApiClient,
    media: &Media,
    action: &'static str,
    position: f64,
    duration: f64,
    session: Option<&PlaybackSession>,
    delivery: ReportDelivery,
) {
    let report = PlaybackReport {
        media_id: media.id,
        action,
        position,
        duration,
        media_type: media
            .mime_type
            .as_deref()
            .unwrap_or("application/octet-stream"),
        title: media.title(),
        artists: media.artists.as_deref(),
        source: "desktop",
    };
    if position >= 2.0 && (duration == 0.0 || position < duration - 3.0) {
        let _ = client.save_resume(media.id, position, duration).await;
    } else if duration > 0.0 && position >= duration - 3.0 {
        let _ = client.save_resume(media.id, 0.0, duration).await;
    }
    if !delivery.socket_primary {
        let _ = client
            .report(&Endpoint::PlaybackActive, &report, session)
            .await;
    }
    if delivery.record_event {
        let _ = client
            .report(&Endpoint::PlaybackEvent, &report, session)
            .await;
    }
}

pub(crate) fn set_color_scheme(mut app: Signal<NativeApp>, scheme: ColorScheme) {
    app.write().settings.color_scheme = scheme;
    let settings = app.read().settings.clone();
    if let Err(error) = app.read().store.save(&settings) {
        tracing::warn!(%error, "failed to persist updated color scheme");
    }
}

fn save_settings(mut app: Signal<NativeApp>) {
    let mut candidate = app.read().settings.clone();
    let settings_url = app.read().settings_url.clone();
    let allow_http = app.read().allow_http;
    let previous_url = app.read().settings.server_url.clone();
    let is_connected = app.read().library.access == AccessView::Ready;

    match candidate.set_server_url(&settings_url) {
        Ok(true) if !allow_http => {
            let msg = "Plain HTTP to a remote server requires checking 'Trust plain HTTP for a remote server' below.".to_owned();
            app.write().settings_error = Some(msg.clone());
            app.write().status = Some(msg);
        }
        Ok(_) => {
            let url_changed = candidate.server_url != previous_url;
            let current_client_is_connected =
                !url_changed && is_connected && app.read().client.is_some();
            if current_client_is_connected {
                let _ = app.read().store.save(&candidate);
                app.write().settings = candidate;
                app.write().settings_error = None;
                app.write().settings_open = false;
                return;
            }

            if url_changed {
                app.write().on_server_disconnected();
            }

            match ApiClient::new(
                &candidate.server_url.to_string(),
                candidate.viewer_id.clone(),
            ) {
                Ok(client) => {
                    let save_result = app.read().store.save(&candidate);
                    if let Err(error) = save_result {
                        let msg = format!("Failed to save settings: {error}");
                        app.write().settings_error = Some(msg.clone());
                        app.write().status = Some(msg);
                        return;
                    }

                    app.write().settings = candidate;
                    app.write().client = Some(client.clone());
                    app.write().settings_error = None;
                    app.write().settings_connecting = true;
                    app.write().access_tier = 0;
                    app.write().library.access = AccessView::Checking;
                    app.write().status = Some("Verifying server connection…".to_owned());

                    spawn(async move {
                        match client.check_access().await {
                            Ok(status) => {
                                exit_local_mode(app);
                                {
                                    let mut state = app.write();
                                    state.on_server_connected();
                                    state.access_tier = status.tier;
                                    state.library.access = AccessView::Ready;
                                    state.settings_open = false;
                                    state.settings_connecting = false;
                                    state.settings_error = None;
                                    state.status =
                                        Some("Connected to server successfully.".to_owned());
                                }

                                match client.categories().await {
                                    Ok(value) => {
                                        app.write().categories = value.clone();
                                        for category in value {
                                            ensure_category_artwork(app, category);
                                        }
                                    }
                                    Err(error) => app.write().status = Some(error.user_message()),
                                }
                                begin_browse(app);
                                load_queue(app);
                            }
                            Err(ApiError::AccessDenied) => {
                                let msg = "Access Denied: The server received the request, but this computer's IP address is not whitelisted (tier < 100). Please add this IP in the server whitelist.".to_owned();
                                let mut state = app.write();
                                state.on_server_disconnected();
                                state.library.access = AccessView::Denied;
                                state.settings_connecting = false;
                                state.settings_error = Some(msg.clone());
                                state.status = Some(msg);
                                state.settings_open = true;
                            }
                            Err(error) => {
                                let user_msg = error.user_message();
                                let msg = format!(
                                    "Cannot connect to server: {user_msg}. Please check the server address, port, and network connection."
                                );
                                let mut state = app.write();
                                state.on_server_disconnected();
                                state.library.access = AccessView::Unreachable(user_msg);
                                state.settings_connecting = false;
                                state.settings_error = Some(msg.clone());
                                state.status = None;
                                state.settings_open = true;
                                drop(state);
                                auto_open_local_folder(app);
                            }
                        }
                    });
                }
                Err(error) => {
                    let msg = error.user_message();
                    let mut state = app.write();
                    state.on_server_disconnected();
                    state.settings_error = Some(msg.clone());
                    state.status = Some(msg);
                }
            }
        }
        Err(error) => {
            let msg = match &error {
                SettingsError::InvalidUrl(ServerUrlError::UnsupportedScheme) => {
                    "Invalid URL: Protocol must be http:// or https:// (e.g. http://127.0.0.1:3001/)".to_owned()
                }
                SettingsError::InvalidUrl(ServerUrlError::MissingHost) => {
                    "Invalid URL: Please specify a valid host (e.g. 127.0.0.1 or media.example.com)".to_owned()
                }
                other => format!("Invalid server URL: {other}"),
            };
            app.write().settings_error = Some(msg.clone());
            app.write().status = Some(msg);
        }
    }
}

fn media_kind(media: &crate::domain::Media) -> &str {
    media
        .mime_type
        .as_deref()
        .and_then(|mime| mime.split('/').next())
        .unwrap_or("media")
}

pub(crate) fn media_folder_name(folder: &str) -> &str {
    let trimmed = folder.trim().trim_end_matches(['/', '\\']).trim();
    if let Some(last_part) = trimmed.rsplit(['/', '\\']).next() {
        let part_trimmed = last_part.trim();
        if !part_trimmed.is_empty() {
            return part_trimmed;
        }
    }
    if !trimmed.is_empty() {
        trimmed
    } else {
        "Library"
    }
}

pub(crate) fn media_folder(media: &crate::domain::Media) -> &str {
    if let Some(name) = media
        .category_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return media_folder_name(name);
    }
    if let Some(path) = media
        .category_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return media_folder_name(path);
    }
    "Library"
}

pub(crate) fn format_duration(duration: Option<f64>) -> String {
    let seconds = duration.unwrap_or_default().max(0.0) as u64;
    format!("{}:{:02}", seconds / 60, seconds % 60)
}

fn format_added_date(value: Option<&str>) -> String {
    let Some(date) = value.and_then(|value| value.get(..10)) else {
        return "—".to_owned();
    };
    let mut fields = date.split('-');
    let (Some(year), Some(month), Some(day), None) =
        (fields.next(), fields.next(), fields.next(), fields.next())
    else {
        return "—".to_owned();
    };
    let Ok(month_index) = month.parse::<usize>() else {
        return "—".to_owned();
    };
    if !(1..=12).contains(&month_index) {
        return "—".to_owned();
    }
    let Ok(day) = day.parse::<u8>() else {
        return "—".to_owned();
    };
    let Some(month) = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]
    .get(month_index.saturating_sub(1)) else {
        return "—".to_owned();
    };
    format!("{month} {day}, {year}")
}

pub(crate) fn format_language_label(code: Option<&str>) -> String {
    let Some(code) = code else {
        return "Unknown".to_owned();
    };
    match code.to_lowercase().as_str() {
        "ind" | "id" | "indonesia" | "indonesian" => "Indonesia".to_owned(),
        "eng" | "en" | "english" => "English".to_owned(),
        "jpn" | "ja" | "japanese" | "jepang" => "Jepang".to_owned(),
        "spa" | "es" | "spanish" | "spanyol" => "Spanyol".to_owned(),
        "fra" | "fr" | "french" | "prancis" => "Prancis".to_owned(),
        "deu" | "de" | "german" | "jerman" => "Jerman".to_owned(),
        "zho" | "zh" | "chinese" | "mandarin" => "Mandarin".to_owned(),
        "kor" | "ko" | "korean" | "korea" => "Korea".to_owned(),
        "und" => "Unknown".to_owned(),
        other => {
            if let Some(first) = other.chars().next() {
                format!("{}{}", first.to_uppercase(), &other[first.len_utf8()..])
            } else {
                "Unknown".to_owned()
            }
        }
    }
}

fn subtitle_label(track: &SubtitleTrack) -> String {
    let lang = format_language_label(track.language.as_deref());
    if let Some(title) = track.title.as_deref() {
        if !title.is_empty() && track.language.as_deref() != Some(title) {
            format!("{lang} ({title})")
        } else {
            lang
        }
    } else {
        lang
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extras_update_releases_signal_read_before_writing() {
        fn harness() -> Element {
            let app = use_signal(|| {
                let mut state = NativeApp::boot();
                let media: Media = serde_json::from_value(serde_json::json!({ "id": 7 })).unwrap();
                state.coordinator.load(media);
                state
            });
            use_hook(move || {
                apply_extras_if_current(app, MediaId::new(7), "line".to_owned(), vec![]);
                assert_eq!(app.read().lyrics, "line");
                apply_extras_if_current(app, MediaId::new(8), "stale".to_owned(), vec![]);
                assert_eq!(app.read().lyrics, "line");
            });
            rsx! {}
        }

        let vdom = dioxus_core::VirtualDom::new(harness);
        let mut document = dioxus_native::DioxusDocument::new(vdom, Default::default());
        document.initial_build();
    }

    #[test]
    fn native_duration_is_clamped_and_zero_padded() {
        assert_eq!(format_duration(Some(65.9)), "1:05");
        assert_eq!(format_duration(Some(-2.0)), "0:00");
        assert_eq!(format_duration(None), "0:00");
    }

    #[test]
    fn added_date_matches_the_web_library_format() {
        assert_eq!(
            format_added_date(Some("2026-09-29T12:30:00.000Z")),
            "Sep 29, 2026"
        );
        assert_eq!(format_added_date(None), "—");
        assert_eq!(format_added_date(Some("invalid")), "—");
    }

    #[test]
    fn format_language_label_matches_web() {
        assert_eq!(format_language_label(Some("ind")), "Indonesia");
        assert_eq!(format_language_label(Some("eng")), "English");
        assert_eq!(format_language_label(Some("jpn")), "Jepang");
        assert_eq!(format_language_label(Some("spa")), "Spanyol");
        assert_eq!(format_language_label(Some("fra")), "Prancis");
        assert_eq!(format_language_label(Some("deu")), "Jerman");
        assert_eq!(format_language_label(Some("zho")), "Mandarin");
        assert_eq!(format_language_label(Some("kor")), "Korea");
        assert_eq!(format_language_label(Some("und")), "Unknown");
        assert_eq!(format_language_label(None), "Unknown");
        assert_eq!(format_language_label(Some("ita")), "Ita");
    }

    #[test]
    fn subtitle_label_combines_language_and_title() {
        use crate::domain::{StreamPath, SubtitleId};

        let track_both = SubtitleTrack {
            id: SubtitleId::new(1),
            language: Some("eng".to_string()),
            title: Some("Full Commentary".to_string()),
            vtt_url: StreamPath::new("api/media/1/subtitles/1/vtt"),
            ass_url: None,
        };
        assert_eq!(subtitle_label(&track_both), "English (Full Commentary)");

        let track_same = SubtitleTrack {
            id: SubtitleId::new(2),
            language: Some("ind".to_string()),
            title: Some("ind".to_string()),
            vtt_url: StreamPath::new("api/media/1/subtitles/2/vtt"),
            ass_url: None,
        };
        assert_eq!(subtitle_label(&track_same), "Indonesia");

        let track_no_title = SubtitleTrack {
            id: SubtitleId::new(3),
            language: Some("jpn".to_string()),
            title: None,
            vtt_url: StreamPath::new("api/media/1/subtitles/3/vtt"),
            ass_url: None,
        };
        assert_eq!(subtitle_label(&track_no_title), "Jepang");
    }

    #[test]
    fn webvtt_parser_handles_ids_settings_markup_and_crlf() {
        let source = b"WEBVTT\r\n\r\nfirst\r\n00:00:01.250 --> 00:00:03.500 align:center\r\n<c.green>Hello &amp; welcome</c>\r\nsecond line\r\n\r\n00:01:02.000 --> 00:01:03.000\r\nBye\r\n";
        let cues = parse_webvtt(source).unwrap();

        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0].start, 1.25);
        assert_eq!(cues[0].end, 3.5);
        assert_eq!(cues[0].text, "Hello & welcome\nsecond line");
        assert_eq!(cues[1].start, 62.0);
        assert_eq!(cues[1].text, "Bye");
    }

    #[test]
    fn webvtt_parser_ignores_invalid_and_empty_cues() {
        let source = b"WEBVTT\n\n00:00:04.000 --> 00:00:03.000\nbackwards\n\nnot a cue\n\n00:00:05,000 --> 00:00:06,500\n<i></i>\n";
        assert!(parse_webvtt(source).unwrap().is_empty());
    }

    #[test]
    fn artwork_cache_keys_include_the_server_version() {
        let mut media: Media = serde_json::from_value(serde_json::json!({
            "id": 4,
            "artwork_version": "first.webp"
        }))
        .unwrap();
        let first = ArtworkCache::key(&media);
        media.artwork_version = Some("second.webp".into());
        assert_ne!(first, ArtworkCache::key(&media));
    }

    #[test]
    fn category_artwork_cache_keys_include_the_cover_version() {
        let mut category: Category = serde_json::from_value(serde_json::json!({
            "id": 22,
            "name": "Absolution",
            "cover_path": "22/front-old.webp"
        }))
        .unwrap();
        let first = ArtworkCache::category_key(&category);
        category.cover_path = Some("22/front-new.webp".into());
        assert_ne!(first, ArtworkCache::category_key(&category));
    }

    #[test]
    fn artwork_cache_clears_other_media_immediately() {
        let mut cache = ArtworkCache::default();
        let media_1: Media = serde_json::from_value(serde_json::json!({"id": 101})).unwrap();
        let media_2: Media = serde_json::from_value(serde_json::json!({"id": 102})).unwrap();

        let key_1 = cache.start(&media_1).unwrap();
        cache.finish(
            key_1.clone(),
            ArtworkState::Ready(Arc::new("data:image/png;base64,TRACK1".to_owned())),
        );
        assert!(cache.get(&media_1).is_some());
        assert_eq!(cache.ready_bytes, "data:image/png;base64,TRACK1".len());

        // When switching to media_2, clear other media immediately
        cache.clear_other_media(Some(&media_2));
        assert!(cache.get(&media_1).is_none());
        assert_eq!(cache.ready_bytes, 0);

        let key_2 = cache.start(&media_2).unwrap();
        cache.finish(
            key_2,
            ArtworkState::Ready(Arc::new("data:image/png;base64,TRACK2".to_owned())),
        );
        assert!(cache.get(&media_2).is_some());
        assert_eq!(cache.ready_bytes, "data:image/png;base64,TRACK2".len());

        // When stopping or clearing all media
        cache.clear_other_media(None);
        assert!(cache.get(&media_2).is_none());
        assert_eq!(cache.ready_bytes, 0);
    }

    #[test]
    fn artwork_disk_caching_and_eviction() {
        let test_bytes = b"\x89PNG\r\n\x1a\nfake_png_data";
        let key = "media:999:test_version";
        let url = artwork_source_url(key, test_bytes.to_vec());

        #[cfg(not(target_os = "windows"))]
        {
            assert!(url.starts_with("file://"));
            let parsed = url::Url::parse(&url).unwrap();
            let file_path = parsed.to_file_path().unwrap();
            assert!(file_path.exists());
            assert_eq!(std::fs::read(&file_path).unwrap(), test_bytes);

            // When evicted from ArtworkCache, file should be removed from disk
            let mut cache = ArtworkCache::default();
            cache
                .entries
                .insert(key.to_string(), ArtworkState::Ready(Arc::new(url)));
            cache.evict(key);
            assert!(!file_path.exists());
        }

        #[cfg(target_os = "windows")]
        {
            assert!(url.starts_with("data:image/png;base64,"));
        }
    }

    #[test]
    fn artwork_cache_remains_bounded() {
        let mut cache = ArtworkCache::default();
        for id in 1..=(ARTWORK_CACHE_LIMIT + 4) {
            let media: Media = serde_json::from_value(serde_json::json!({"id": id})).unwrap();
            cache.start(&media);
        }
        assert_eq!(cache.entries.len(), ARTWORK_CACHE_LIMIT);
    }

    #[test]
    fn artwork_cache_evicts_oldest_encoded_bytes() {
        let mut cache = ArtworkCache::default();
        let first = "first".to_owned();
        let second = "second".to_owned();
        cache.start_key(first.clone());
        cache.finish(
            first.clone(),
            ArtworkState::Ready(Arc::new("a".repeat(ARTWORK_CACHE_BYTES / 2 + 1))),
        );
        cache.start_key(second.clone());
        cache.finish(
            second.clone(),
            ArtworkState::Ready(Arc::new("b".repeat(ARTWORK_CACHE_BYTES / 2))),
        );
        assert!(!cache.entries.contains_key(&first));
        assert!(cache.entries.contains_key(&second));
        assert!(cache.ready_bytes <= ARTWORK_CACHE_BYTES);
    }

    #[test]
    fn oversize_artwork_does_not_enter_ready_cache() {
        let mut cache = ArtworkCache::default();
        let key = "oversize".to_owned();
        cache.start_key(key.clone());
        cache.finish(
            key.clone(),
            ArtworkState::Ready(Arc::new("a".repeat(ARTWORK_CACHE_BYTES + 1))),
        );
        assert!(matches!(
            cache.entries.get(&key),
            Some(ArtworkState::Missing)
        ));
        assert_eq!(cache.ready_bytes, 0);
    }

    #[test]
    fn artwork_state_clone_shares_encoded_image() {
        let image = Arc::new("data:image/png;base64,AAAA".to_owned());
        let state = ArtworkState::Ready(image.clone());
        let projection = state.clone();
        assert_eq!(Arc::strong_count(&image), 3);
        drop(projection);
        assert_eq!(Arc::strong_count(&image), 2);
    }

    #[test]
    fn native_artwork_decoders_are_enabled() {
        use image::ImageFormat;

        for format in [
            ImageFormat::Gif,
            ImageFormat::Jpeg,
            ImageFormat::Png,
            ImageFormat::WebP,
        ] {
            assert!(format.reading_enabled(), "{format:?} decoder is disabled");
        }
    }

    #[test]
    fn slider_and_duration_format_correctly() {
        use super::kit::slider_value_at;

        assert_eq!(format_duration(Some(0.0)), "0:00");
        assert_eq!(format_duration(Some(65.0)), "1:05");
        assert_eq!(format_duration(Some(3600.0)), "60:00");
        assert_eq!(format_duration(None), "0:00");

        assert_eq!(slider_value_at(0, 100, 0.0, 240.0, 0.1), 0.0);
        assert_eq!(slider_value_at(50, 100, 0.0, 240.0, 0.1), 120.0);
        assert_eq!(slider_value_at(100, 100, 0.0, 240.0, 0.1), 240.0);
        assert_eq!(slider_value_at(75, 100, 0.0, 100.0, 1.0), 75.0);
        assert_eq!(slider_value_at(20, 40, 0.0, 100.0, 1.0), 50.0);
        assert_eq!(slider_value_at(40, 40, 0.0, 100.0, 1.0), 100.0);
    }

    #[test]
    fn draggable_components_render_correctly() {
        use super::kit::{Draggable, DraggableItem, DraggableZone};

        let _ = rsx! {
            Draggable {
                DraggableZone {
                    DraggableItem {
                        draggable: true,
                        dragging: false,
                        span { "Item 1" }
                    }
                    DraggableItem {
                        draggable: true,
                        dragging: true,
                        span { "Item 2" }
                    }
                }
            }
        };
    }

    #[test]
    fn category_name_truncates_without_wrapping() {
        use super::views::truncate_category_name;

        assert_eq!(truncate_category_name("Short Name", 0), "Short Name");
        assert_eq!(
            truncate_category_name("Electronic & Ambient Music", 0),
            "Electronic & Ambien…"
        );
        assert_eq!(
            truncate_category_name("Nested Category Long", 2),
            "Nested Category…"
        );
    }

    #[test]
    fn category_queue_actions_require_direct_media() {
        use super::views::category_has_media;

        assert!(!category_has_media(0));
        assert!(category_has_media(1));
        assert!(category_has_media(42));
    }

    #[test]
    fn takeover_button_is_gated_by_access_tier() {
        use super::views::{SessionConflictCard, can_take_over_playback};

        assert!(can_take_over_playback(100));
        assert!(can_take_over_playback(999));
        assert!(!can_take_over_playback(0));
        assert!(!can_take_over_playback(99));

        fn conflict_harness() -> Element {
            let holder = SessionHolder {
                platform: Some("desktop".to_owned()),
                device_label: Some("Studio PC".to_owned()),
                media_id: None,
                expires_in: Some(20),
                playback: None,
            };
            rsx! {
                SessionConflictCard { holder: Some(holder) }
                SessionConflictCard { holder: None }
            }
        }

        let vdom = dioxus_core::VirtualDom::new(conflict_harness);
        let mut document = dioxus_native::DioxusDocument::new(vdom, Default::default());
        document.initial_build();

        let mut rendered_parts = Vec::new();
        document.inner.visit(|_, node| {
            let Some(element) = node.element_data() else {
                return;
            };
            if let Some(name) = element
                .attrs
                .iter()
                .find(|attr| attr.name.local.as_ref() == "data-name")
            {
                rendered_parts.push(name.value.clone());
            }
        });
        assert_eq!(
            rendered_parts
                .iter()
                .filter(|name| *name == "SessionConflictCard")
                .count(),
            2
        );
    }

    #[test]
    fn media_folder_shows_leaf_parent_only() {
        use crate::domain::{Media, MediaId};

        assert_eq!(
            super::media_folder_name("Music / Muse / Absolution"),
            "Absolution"
        );
        assert_eq!(
            super::media_folder_name("Shows / Season Two /"),
            "Season Two"
        );
        assert_eq!(super::media_folder_name("SingleFolder"), "SingleFolder");
        assert_eq!(super::media_folder_name(""), "Library");

        let media_with_path = Media {
            id: MediaId::new(1),
            title: Some("Hysteria".to_string()),
            artists: None,
            description: None,
            duration: None,
            mime_type: Some("audio/flac".to_string()),
            category_id: None,
            category_name: None,
            category_path: Some("Music / Muse / Absolution".to_string()),
            artwork_version: None,
            liked: false,
            source_version: None,
            created_at: None,
        };
        assert_eq!(super::media_folder(&media_with_path), "Absolution");

        let media_with_both = Media {
            category_name: Some("Absolution".to_string()),
            ..media_with_path.clone()
        };
        assert_eq!(super::media_folder(&media_with_both), "Absolution");

        let media_empty = Media {
            id: MediaId::new(2),
            title: None,
            artists: None,
            description: None,
            duration: None,
            mime_type: None,
            category_id: None,
            category_name: None,
            category_path: None,
            artwork_version: None,
            liked: false,
            source_version: None,
            created_at: None,
        };
        assert_eq!(super::media_folder(&media_empty), "Library");
    }

    #[test]
    fn settings_url_validation_identifies_invalid_schemes_and_hosts() {
        let mut settings = Settings::default();
        let err1 = settings.set_server_url("ftp://127.0.0.1:3001").unwrap_err();
        assert!(matches!(
            err1,
            SettingsError::InvalidUrl(ServerUrlError::UnsupportedScheme)
        ));

        let err2 = settings.set_server_url("not a url").unwrap_err();
        assert!(matches!(err2, SettingsError::InvalidUrl(_)));
    }

    #[test]
    fn native_css_includes_keyboard_focus_visible_styling() {
        assert!(super::CSS.contains(":focus-visible"));
        assert!(super::CSS.contains("outline: 2px solid var(--focus)"));
        assert!(super::CSS.contains(".chip:focus-visible"));
        assert!(super::CSS.contains(".track-main:focus-visible"));
    }

    #[test]
    fn server_connect_and_disconnect_purges_unrelated_memory() {
        let mut app = NativeApp::boot();

        let cat: Category = serde_json::from_value(serde_json::json!({
            "id": 1,
            "name": "Rock"
        }))
        .unwrap();
        app.categories.push(cat);
        let med: Media = serde_json::from_value(serde_json::json!({
            "id": 10,
            "title": "Song"
        }))
        .unwrap();
        app.library.items.push(med.clone());
        app.lyrics = "Sample lyrics".to_owned();
        app.photo_data_url = Some(std::sync::Arc::new("data:image/jpeg;base64,...".to_owned()));
        app.socket_ready = true;
        app.socket_session_id = Some("sess-1".to_owned());
        let key = app.artwork.start(&med).unwrap();
        app.artwork.finish(
            key,
            ArtworkState::Ready(std::sync::Arc::new("data:image/png;base64,DATA".to_owned())),
        );

        assert!(!app.categories.is_empty());
        assert!(!app.library.items.is_empty());
        assert!(!app.lyrics.is_empty());
        assert!(app.photo_data_url.is_some());
        assert!(app.artwork.get(&med).is_some());

        // Disconnect state: all server data must be completely purged from memory
        app.purge_server_memory();

        assert!(app.categories.is_empty());
        assert_eq!(app.categories.capacity(), 0);
        assert!(app.library.items.is_empty());
        assert_eq!(app.library.items.capacity(), 0);
        assert!(app.lyrics.is_empty());
        assert_eq!(app.lyrics.capacity(), 0);
        assert!(app.photo_data_url.is_none());
        assert!(app.queue.is_none());
        assert!(app.session.is_none());
        assert!(!app.socket_ready);
        assert!(app.socket_session_id.is_none());
        assert!(app.artwork.get(&med).is_none());
        assert_eq!(app.artwork.ready_bytes, 0);

        // Populate local mode data
        app.local_mode = true;
        app.local_tracks.push(LocalTrack {
            path: std::path::PathBuf::from("/music/song.mp3"),
            title: "Local Song".to_owned(),
            kind: crate::domain::LocalKind::Audio,
            duration: None,
        });
        assert!(!app.local_tracks.is_empty());

        // Connected state: all local mode data must be completely purged from memory
        app.purge_local_memory();

        assert!(app.local_tracks.is_empty());
        assert_eq!(app.local_tracks.capacity(), 0);
        assert!(!app.local_mode);
        assert!(app.local_index.is_none());
    }
}
