mod kit;
mod video_surface;
mod views;

use std::collections::{HashMap, VecDeque};

use base64::Engine as _;
use dioxus_native::prelude::*;

use crate::{
    api::{ApiClient, ApiError, Endpoint},
    app::{AccessView, AppState},
    domain::{
        BrowseQuery, Category, CategoryId, DashboardQuery, DashboardSummary, Limit, Media,
        MediaFilter, MediaId, PlaybackReport, PlaybackSession, Quality, QueueWindow, SubtitleTrack,
        Volume,
    },
    playback::{
        EngineEvent, PlaybackCoordinator, PlaybackEngine, PlaybackStatus, VideoFrameReceiver,
    },
    store::{ColorScheme, Settings, SettingsStore},
};

use kit::{
    Artwork, Button, Chip, Icon, IconButton, IconName, Input, MediaListSkeleton, Notice, Select,
    Skeleton, StatusBadge, ThemeToggle,
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

#[derive(Clone, Debug, PartialEq, Eq)]
enum ArtworkState {
    Loading,
    Ready(String),
    Missing,
}

#[derive(Clone, Debug, Default)]
struct ArtworkCache {
    entries: HashMap<String, ArtworkState>,
    order: VecDeque<String>,
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
                self.entries.remove(&oldest);
            }
        }
        self.order.push_back(key.clone());
        self.entries.insert(key.clone(), ArtworkState::Loading);
        Some(key)
    }

    fn finish(&mut self, key: String, state: ArtworkState) {
        if self.entries.contains_key(&key) {
            self.entries.insert(key, state);
        }
    }

    fn remove(&mut self, key: &str) {
        self.entries.remove(key);
        self.order.retain(|entry| entry != key);
    }
}

#[derive(Clone)]
pub(crate) struct NativeApp {
    store: SettingsStore,
    settings: Settings,
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
    coordinator: PlaybackCoordinator,
    session: Option<PlaybackSession>,
    lyrics: String,
    subtitles: Vec<SubtitleTrack>,
    selected_subtitle: Option<usize>,
    subtitle_cues: Vec<SubtitleCue>,
    photo_data_url: Option<String>,
    player_expanded: bool,
    queue_open: bool,
    settings_open: bool,
    settings_url: String,
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
                Err(error) => (
                    None,
                    AccessView::Unreachable(error.user_message()),
                    Some(error.user_message()),
                ),
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
        Self {
            store,
            settings,
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
            coordinator,
            session: None,
            lyrics: String::new(),
            subtitles: Vec::new(),
            selected_subtitle: None,
            subtitle_cues: Vec::new(),
            photo_data_url: None,
            player_expanded: false,
            queue_open: false,
            settings_open,
            settings_url,
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

pub fn run() {
    // Dioxus Native owns the main-thread event loop, while API requests and
    // timers use Tokio. Keep a multithread runtime alive and entered for the
    // full Blitz event-loop lifetime so hooks can create Tokio I/O and timers.
    let runtime =
        tokio::runtime::Runtime::new().expect("failed to initialize the native async runtime");
    let _runtime_guard = runtime.enter();
    dioxus_native::launch(App);
}

#[component]
fn App() -> Element {
    let mut app = use_signal(NativeApp::boot);
    let engine = use_signal(|| PlaybackEngine::new().ok());
    let frames = use_hook(|| {
        engine
            .read()
            .as_ref()
            .map(PlaybackEngine::frame_receiver)
            .unwrap_or_else(VideoFrameReceiver::default)
    });
    let video_source_id = dioxus_native::use_wgpu(move || VideoPaintSource::new(frames.clone()));
    use_hook(move || {
        if engine.read().is_none() {
            app.write().status = Some(
                "GStreamer playback is unavailable. Photos and browsing still work.".to_owned(),
            );
        }
        connect(app);
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
    use_future(move || async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            tick_playback(app, engine);
        }
    });
    use_future(move || async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(10)).await;
            heartbeat(app, engine);
        }
    });

    rsx! { Shell { app, engine, video_source_id } }
}

fn connect(mut app: Signal<NativeApp>) {
    let Some(client) = app.read().client.clone() else {
        return;
    };
    spawn(async move {
        match client.check_access().await {
            Ok(_) => {
                app.write().library.access = AccessView::Ready;
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
                app.write().library.access = AccessView::Denied;
                app.write().status = Some(ApiError::AccessDenied.user_message());
            }
            Err(error) => {
                app.write().library.access = AccessView::Unreachable(error.user_message());
                app.write().status = Some(error.user_message());
            }
        }
    });
}

fn refresh(mut app: Signal<NativeApp>) {
    app.write().status = None;
    connect(app);
}

fn begin_browse(mut app: Signal<NativeApp>) {
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
                if app.write().library.fail(generation) {
                    app.write().status = Some(error.user_message());
                }
            }
        }
    });
}

fn load_dashboard(mut app: Signal<NativeApp>) {
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
        if let Ok(summary) = client.dashboard(&query).await
            && app.read().dashboard_generation == generation
        {
            let featured = summary
                .featured_id
                .and_then(|id| summary.media.iter().find(|media| media.id == id).cloned());
            app.write().dashboard = summary;
            if let Some(media) = featured {
                ensure_artwork(app, media);
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

fn artwork_url(app: &NativeApp, media: &Media) -> Option<String> {
    match app.artwork.get(media) {
        Some(ArtworkState::Ready(value)) => Some(value.clone()),
        _ => None,
    }
}

fn category_artwork_url(app: &NativeApp, category: &Category) -> Option<String> {
    match app.artwork.get_category(category) {
        Some(ArtworkState::Ready(value)) => Some(value.clone()),
        _ => None,
    }
}

fn ensure_category_artwork(mut app: Signal<NativeApp>, category: Category) {
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
            Ok(bytes) => Some(ArtworkState::Ready(artwork_data_url(bytes))),
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
    let Some(client) = app.read().client.clone() else {
        return;
    };
    let Some(key) = app.write().artwork.start(&media) else {
        return;
    };
    spawn(async move {
        let result = match client.media_thumbnail(media.id).await {
            Ok(bytes) => Some(ArtworkState::Ready(artwork_data_url(bytes))),
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
                if app.write().library.fail(generation) {
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
    play_media_at(app, engine, media, auto_queue, None);
}

fn play_media_at(
    mut app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
    media: Media,
    auto_queue: bool,
    resume_at: Option<f64>,
) {
    ensure_artwork(app, media.clone());
    if media.is_photo() {
        play_photo(app, engine, media, auto_queue);
        return;
    }
    let Some(client) = app.read().client.clone() else {
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
        let _ = engine.stop();
    }
    app.write().coordinator.load(media.clone());
    app.write().player_expanded = media.is_video();
    let sequence = app.read().coordinator.snapshot().sequence;
    let quality = app.read().settings.quality;
    app.write().lyrics.clear();
    app.write().subtitles.clear();
    app.write().selected_subtitle = None;
    app.write().subtitle_cues.clear();
    app.write().photo_data_url = None;
    app.write().status = None;

    if let Some(previous) = previous {
        let release_client = client.clone();
        spawn(async move {
            send_report(
                &release_client,
                &previous,
                "pause",
                previous_position,
                previous_duration,
                true,
            )
            .await;
            if let Some(session) = previous_session {
                let _ = release_client.release(&session).await;
            }
        });
    }

    if auto_queue {
        auto_fill_queue(app, media.id);
    }
    load_extras(app, media.id);
    spawn(async move {
        let resume = match resume_at {
            Some(position) => position,
            None => client
                .resume(media.id)
                .await
                .ok()
                .and_then(|value| value.position)
                .unwrap_or(0.0),
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
                app.write()
                    .coordinator
                    .failed(sequence, error.user_message());
                app.write().status = Some(error.user_message());
                return;
            }
        };
        if app.read().coordinator.snapshot().sequence != sequence {
            let _ = client.release(&session).await;
            return;
        }
        let started = engine
            .read()
            .as_ref()
            .map(|engine| engine.open(&session, &stream).and_then(|_| engine.play()));
        match started {
            Some(Ok(())) => {
                if let Some(engine) = engine.read().as_ref() {
                    if resume > 0.0 {
                        engine.seek(resume);
                    }
                    engine.set_volume(app.read().settings.volume);
                }
                app.write().session = Some(session);
                app.write().coordinator.loaded(sequence, resume);
                send_report(
                    &client,
                    &media,
                    "play",
                    resume,
                    media.duration.unwrap_or(0.0),
                    true,
                )
                .await;
            }
            Some(Err(error)) => {
                let message = error.to_string();
                app.write().coordinator.failed(sequence, &message);
                app.write().status = Some(message);
                let _ = client.release(&session).await;
            }
            None => {
                app.write()
                    .coordinator
                    .failed(sequence, "GStreamer playback is unavailable");
                app.write().status = Some("GStreamer playback is unavailable.".to_owned());
                let _ = client.release(&session).await;
            }
        }
    });
}

fn play_photo(
    mut app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
    media: Media,
    auto_queue: bool,
) {
    ensure_artwork(app, media.clone());
    let Some(client) = app.read().client.clone() else {
        return;
    };
    let previous_session = app.write().session.take();
    let previous = app.read().coordinator.snapshot().media.clone();
    let position = app.read().coordinator.snapshot().position;
    let duration = app.read().coordinator.snapshot().duration;
    if let Some(engine) = engine.read().as_ref() {
        let _ = engine.stop();
    }
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
            send_report(&client, &previous, "pause", position, duration, true).await;
        }
        if let Some(session) = previous_session {
            let _ = client.release(&session).await;
        }
        match client.photo(media.id).await {
            Ok(bytes) if app.read().coordinator.snapshot().sequence == sequence => {
                let mime = media.mime_type.as_deref().unwrap_or("image/jpeg");
                let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
                app.write().photo_data_url = Some(format!("data:{mime};base64,{encoded}"));
                app.write().coordinator.loaded(sequence, 0.0);
            }
            Ok(_) => {}
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
    if app.read().coordinator.snapshot().quality == quality {
        return;
    }
    let media = app.read().coordinator.snapshot().media.clone();
    let position = app.read().coordinator.snapshot().position;
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
        play_media_at(app, engine, media, false, Some(position));
    }
}

fn tick_playback(mut app: Signal<NativeApp>, engine: Signal<Option<PlaybackEngine>>) {
    if app.read().coordinator.snapshot().media.is_none() {
        return;
    }
    let event = engine.read().as_ref().and_then(PlaybackEngine::poll_event);
    match event {
        Some(EngineEvent::Ended) => {
            app.write().coordinator.ended();
            navigate_queue(app, engine, true, true);
            return;
        }
        Some(EngineEvent::Failed(error)) => {
            let sequence = app.read().coordinator.snapshot().sequence;
            app.write().coordinator.failed(sequence, &error);
            app.write().status = Some(format!("Playback failed: {error}"));
            return;
        }
        None => {}
    }
    let position = engine.read().as_ref().and_then(PlaybackEngine::position);
    let duration = engine.read().as_ref().and_then(PlaybackEngine::duration);
    if let (Some(position), Some(duration)) = (position, duration) {
        app.write().coordinator.update_timing(position, duration);
    }
}

fn heartbeat(mut app: Signal<NativeApp>, engine: Signal<Option<PlaybackEngine>>) {
    let (Some(client), Some(session), Some(media)) = (
        app.read().client.clone(),
        app.read().session.clone(),
        app.read().coordinator.snapshot().media.clone(),
    ) else {
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
    spawn(async move {
        if session.lease_required
            && let Err(error) = client.heartbeat(&session).await
        {
            if matches!(error, ApiError::PlaybackLeaseLost { .. }) {
                if let Some(engine) = engine.read().as_ref() {
                    let _ = engine.pause();
                }
                app.write().coordinator.lease_lost();
            }
            app.write().status = Some(error.user_message());
        }
        send_report(&client, &media, "play", position, duration, false).await;
    });
}

fn toggle_playback(mut app: Signal<NativeApp>, engine: Signal<Option<PlaybackEngine>>) {
    let Some(media) = app.read().coordinator.snapshot().media.clone() else {
        return;
    };
    let Some(client) = app.read().client.clone() else {
        return;
    };
    let playing = app.read().coordinator.snapshot().status == PlaybackStatus::Playing;
    let result = engine.read().as_ref().map(|engine| {
        if playing {
            engine.pause()
        } else {
            engine.play()
        }
    });
    if matches!(result, Some(Ok(()))) {
        if playing {
            app.write().coordinator.pause();
        } else {
            app.write().coordinator.play();
        }
        let position = app.read().coordinator.snapshot().position;
        let duration = app.read().coordinator.snapshot().duration;
        spawn(async move {
            send_report(
                &client,
                &media,
                if playing { "pause" } else { "play" },
                position,
                duration,
                true,
            )
            .await;
        });
    }
}

fn stop_playback(mut app: Signal<NativeApp>, engine: Signal<Option<PlaybackEngine>>) {
    let client = app.read().client.clone();
    let session = app.write().session.take();
    let media = app.read().coordinator.snapshot().media.clone();
    let position = app.read().coordinator.snapshot().position;
    let duration = app.read().coordinator.snapshot().duration;
    if let Some(engine) = engine.read().as_ref() {
        let _ = engine.stop();
    }
    app.write().coordinator.stop();
    app.write().photo_data_url = None;
    app.write().lyrics.clear();
    app.write().subtitles.clear();
    app.write().selected_subtitle = None;
    app.write().subtitle_cues.clear();
    app.write().player_expanded = false;
    app.write().queue_open = false;
    if let Some(client) = client {
        spawn(async move {
            if let Some(media) = media {
                send_report(&client, &media, "pause", position, duration, true).await;
            }
            if let Some(session) = session {
                let _ = client.release(&session).await;
            }
        });
    }
}

fn seek(mut app: Signal<NativeApp>, engine: Signal<Option<PlaybackEngine>>, position: f64) {
    if let Some(engine) = engine.read().as_ref() {
        engine.seek(position);
    }
    app.write().coordinator.update_position(position);
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

fn load_queue(mut app: Signal<NativeApp>) {
    let Some(client) = app.read().client.clone() else {
        return;
    };
    spawn(async move {
        match client.queue_window().await {
            Ok(queue) => app.write().queue = Some(queue),
            Err(error) => app.write().status = Some(error.user_message()),
        }
    });
}

fn auto_fill_queue(app: Signal<NativeApp>, media_id: MediaId) {
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

fn select_queue(app: Signal<NativeApp>, engine: Signal<Option<PlaybackEngine>>, id: MediaId) {
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
            Ok(media) => play_media(app, engine, media, false),
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
    let Some(client) = app.read().client.clone() else {
        return;
    };
    spawn(async move {
        let result = async {
            let selection = client.queue_navigate(forward).await?;
            let id = selection.media_id.ok_or(ApiError::QueueEmpty)?;
            client.media(id).await
        }
        .await;
        match result {
            Ok(media) => play_media(app, engine, media, false),
            Err(error) => {
                if from_eos {
                    stop_playback(app, engine);
                } else {
                    let mut app = app;
                    app.write().status = Some(error.user_message());
                }
            }
        }
    });
}

fn queue_shuffle(app: Signal<NativeApp>) {
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

fn add_media_to_queue(app: Signal<NativeApp>, id: MediaId, next: bool) {
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
    if !media.is_audio() {
        return;
    }
    let Some(client) = app.read().client.clone() else {
        return;
    };
    if app
        .read()
        .coordinator
        .snapshot()
        .media
        .as_ref()
        .is_some_and(|current| current.id == media.id)
    {
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

fn load_extras(mut app: Signal<NativeApp>, media_id: MediaId) {
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
        if app
            .read()
            .coordinator
            .snapshot()
            .media
            .as_ref()
            .is_some_and(|media| media.id == media_id)
        {
            app.write().lyrics = lyrics;
            app.write().subtitles = subtitles;
        }
    });
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
            Err(error) if app.read().selected_subtitle == Some(index) => {
                app.write().status = Some(error.user_message());
            }
            Err(_) => {}
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

async fn send_report(
    client: &ApiClient,
    media: &Media,
    action: &'static str,
    position: f64,
    duration: f64,
    record_event: bool,
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
    let _ = client.save_resume(media.id, position, duration).await;
    let _ = client.report(&Endpoint::PlaybackActive, &report).await;
    if record_event {
        let _ = client.report(&Endpoint::PlaybackEvent, &report).await;
    }
}

fn save_settings(mut app: Signal<NativeApp>) {
    let mut candidate = app.read().settings.clone();
    let settings_url = app.read().settings_url.clone();
    let allow_http = app.read().allow_http;
    match candidate.set_server_url(&settings_url) {
        Ok(true) if !allow_http => {
            app.write().status =
                Some("Plain HTTP requires the trusted-LAN confirmation.".to_owned());
        }
        Ok(_) => {
            let save_result = app.read().store.save(&candidate);
            if let Err(error) = save_result {
                app.write().status = Some(error.to_string());
                return;
            }
            match ApiClient::new(
                &candidate.server_url.to_string(),
                candidate.viewer_id.clone(),
            ) {
                Ok(client) => {
                    app.write().settings = candidate;
                    app.write().client = Some(client);
                    app.write().settings_open = false;
                    app.write().library.access = AccessView::Checking;
                    app.write().status = Some("Checking server access…".to_owned());
                    connect(app);
                }
                Err(error) => app.write().status = Some(error.user_message()),
            }
        }
        Err(error) => app.write().status = Some(error.to_string()),
    }
}

fn media_kind(media: &crate::domain::Media) -> &str {
    media
        .mime_type
        .as_deref()
        .and_then(|mime| mime.split('/').next())
        .unwrap_or("media")
}

fn media_folder(media: &crate::domain::Media) -> &str {
    media
        .category_path
        .as_deref()
        .or(media.category_name.as_deref())
        .unwrap_or("Library")
}

fn format_duration(duration: Option<f64>) -> String {
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

fn subtitle_label(track: &SubtitleTrack) -> String {
    track
        .title
        .clone()
        .or_else(|| track.language.clone())
        .unwrap_or_else(|| "Subtitle".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn artwork_cache_remains_bounded() {
        let mut cache = ArtworkCache::default();
        for id in 1..=(ARTWORK_CACHE_LIMIT + 4) {
            let media: Media = serde_json::from_value(serde_json::json!({"id": id})).unwrap();
            cache.start(&media);
        }
        assert_eq!(cache.entries.len(), ARTWORK_CACHE_LIMIT);
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
}
