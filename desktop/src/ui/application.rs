use std::{fmt, time::Duration};

use iced::{Element, Subscription, Task, Theme, time, widget::image};

use crate::{
    api::{ApiClient, ApiError, Endpoint},
    app::{AccessView, AppState},
    domain::{
        BrowseQuery, Category, CategoryId, Limit, Media, MediaFilter, MediaId, PlaybackReport,
        PlaybackSession, Quality, QueueWindow, SubtitleTrack, Volume,
    },
    playback::{EngineEvent, PlaybackCoordinator, PlaybackEngine, PlaybackStatus},
    store::{ColorScheme, Settings, SettingsStore, subtitle_cache_path},
};

use super::{theme, views};

pub fn run() -> iced::Result {
    iced::application(Dogmedia::boot, Dogmedia::update, Dogmedia::view)
        .title("Dogmedia")
        .theme(Dogmedia::theme)
        .subscription(Dogmedia::subscription)
        .window_size((1180.0, 780.0))
        .run()
}

pub(crate) struct Dogmedia {
    pub(crate) store: SettingsStore,
    pub(crate) settings: Settings,
    pub(crate) settings_open: bool,
    pub(crate) settings_url: String,
    pub(crate) allow_http: bool,
    pub(crate) client: Option<ApiClient>,
    pub(crate) library: AppState,
    pub(crate) categories: Vec<Category>,
    pub(crate) category: CategoryChoice,
    pub(crate) media_filter: MediaFilter,
    pub(crate) search: String,
    pub(crate) favorites_only: bool,
    pub(crate) queue: Option<QueueWindow>,
    pub(crate) selected_queue: Option<MediaId>,
    pub(crate) coordinator: PlaybackCoordinator,
    pub(crate) engine: Option<PlaybackEngine>,
    pub(crate) session: Option<PlaybackSession>,
    pub(crate) artwork: Option<image::Handle>,
    pub(crate) lyrics: String,
    pub(crate) subtitles: Vec<SubtitleTrack>,
    pub(crate) subtitle: SubtitleChoice,
    pub(crate) volume: Volume,
    pub(crate) status: Option<StatusNotice>,
}

/// Typed status banner. API failures keep their [`ApiError`] semantics
/// (including lease retry hints) instead of collapsing to strings.
#[derive(Debug, Clone)]
pub(crate) struct StatusNotice {
    pub(crate) message: String,
    pub(crate) retry_after: Option<u64>,
}

impl StatusNotice {
    fn message(text: impl Into<String>) -> Self {
        Self {
            message: text.into(),
            retry_after: None,
        }
    }
}

impl From<ApiError> for StatusNotice {
    fn from(error: ApiError) -> Self {
        Self {
            retry_after: error.retry_after(),
            message: error.user_message(),
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) enum Message {
    AccessChecked(Result<(), ApiError>),
    CategoriesLoaded(Result<Vec<Category>, ApiError>),
    BrowseLoaded(u64, bool, Result<crate::domain::BrowsePage, ApiError>),
    QueueLoaded(Result<QueueWindow, ApiError>),
    SearchChanged(String),
    MediaFilterChanged(MediaFilter),
    CategoryChanged(CategoryChoice),
    FavoritesChanged(bool),
    Refresh,
    LoadMore,
    MediaPressed(MediaId),
    MediaResolved(Result<Media, ApiError>),
    PlaybackPrepared(u64, Result<(PlaybackSession, url::Url, f64), ApiError>),
    PhotoLoaded(u64, Result<Vec<u8>, ApiError>),
    ExtrasLoaded(Result<(String, Vec<SubtitleTrack>), ApiError>),
    Tick,
    Heartbeat,
    HeartbeatFinished(Result<(), ApiError>),
    TogglePlayback,
    Stop,
    Previous,
    Next,
    Seek(f64),
    VolumeChanged(f64),
    QualityChanged(Quality),
    FavoriteChanged(bool),
    AddToQueue(bool),
    QueuePressed(MediaId),
    QueueRemove,
    QueueClear,
    QueueShuffle,
    QueueMutated(Result<(), ApiError>),
    SubtitleChanged(SubtitleChoice),
    SubtitleDownloaded(Result<String, ApiError>),
    OpenSettings,
    CloseSettings,
    SettingsUrlChanged(String),
    AllowHttpChanged(bool),
    SaveSettings,
    DismissStatus,
    Noop,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct CategoryChoice {
    id: Option<CategoryId>,
    label: String,
}

impl CategoryChoice {
    fn all() -> Self {
        Self {
            id: None,
            label: "All categories".into(),
        }
    }
}

impl fmt::Display for CategoryChoice {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.label)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct SubtitleChoice {
    index: Option<usize>,
    label: String,
}

impl SubtitleChoice {
    fn off() -> Self {
        Self {
            index: None,
            label: "Subtitles off".into(),
        }
    }
}

impl fmt::Display for SubtitleChoice {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.label)
    }
}

impl Dogmedia {
    fn boot() -> (Self, Task<Message>) {
        let store = SettingsStore::discover().unwrap_or_else(|error| {
            tracing::warn!(%error, "using a local settings fallback");
            SettingsStore::at("dogmedia-settings.json")
        });
        let settings = store.load().unwrap_or_else(|error| {
            tracing::warn!(%error, "using default desktop settings");
            Settings::default()
        });
        let engine = PlaybackEngine::new().ok();
        let status = engine.is_none().then(|| {
            StatusNotice::message(
                "GStreamer playback is unavailable. Photos and browsing still work.",
            )
        });
        let mut app = Self {
            store,
            settings_url: settings.server_url.to_string(),
            allow_http: false,
            volume: settings.volume,
            settings,
            settings_open: false,
            client: None,
            library: AppState::default(),
            categories: Vec::new(),
            category: CategoryChoice::all(),
            media_filter: MediaFilter::All,
            search: String::new(),
            favorites_only: false,
            queue: None,
            selected_queue: None,
            coordinator: PlaybackCoordinator::default(),
            engine,
            session: None,
            artwork: None,
            lyrics: String::new(),
            subtitles: Vec::new(),
            subtitle: SubtitleChoice::off(),
            status,
        };
        let task = if app.settings.configured {
            app.connect()
        } else {
            app.settings_open = true;
            Task::none()
        };
        (app, task)
    }

    fn update(&mut self, message: Message) -> Task<Message> {
        match message {
            Message::AccessChecked(result) => match result {
                Ok(()) => {
                    self.library.access = AccessView::Ready;
                    self.status = None;
                    self.refresh()
                }
                Err(ApiError::AccessDenied) => {
                    self.library.access = AccessView::Denied;
                    self.status = Some(ApiError::AccessDenied.into());
                    Task::none()
                }
                Err(error) => {
                    self.library.access = AccessView::Unreachable(error.user_message());
                    self.status = Some(error.into());
                    Task::none()
                }
            },
            Message::CategoriesLoaded(result) => {
                match result {
                    Ok(categories) => self.categories = categories,
                    Err(error) => self.status = Some(error.into()),
                }
                Task::none()
            }
            Message::BrowseLoaded(generation, append, result) => {
                match result {
                    Ok(page) => {
                        self.library.apply_page(generation, page, append);
                    }
                    Err(error) if self.library.fail(generation) => self.status = Some(error.into()),
                    Err(_) => {}
                }
                Task::none()
            }
            Message::QueueLoaded(result) => {
                match result {
                    Ok(queue) => self.queue = Some(queue),
                    Err(error) => self.status = Some(error.into()),
                }
                Task::none()
            }
            Message::SearchChanged(value) => {
                self.search = value;
                self.begin_browse()
            }
            Message::MediaFilterChanged(value) => {
                self.media_filter = value;
                self.begin_browse()
            }
            Message::CategoryChanged(value) => {
                self.category = value;
                self.begin_browse()
            }
            Message::FavoritesChanged(value) => {
                self.favorites_only = value;
                self.begin_browse()
            }
            Message::Refresh => self.refresh(),
            Message::LoadMore => self.load_more(),
            Message::MediaPressed(id) => self.resolve_media(id),
            Message::MediaResolved(result) => match result {
                Ok(media) => self.load_media(media, 0.0),
                Err(error) => {
                    self.status = Some(error.into());
                    Task::none()
                }
            },
            Message::PlaybackPrepared(sequence, result) => match result {
                Ok((session, stream, resume)) => {
                    let Some(engine) = &self.engine else {
                        self.status =
                            Some(StatusNotice::message("GStreamer playback is unavailable."));
                        return Task::none();
                    };
                    if self.coordinator.snapshot().sequence != sequence {
                        return release_task(self.client.clone(), Some(session));
                    }
                    match engine.open(&session, &stream).and_then(|_| engine.play()) {
                        Ok(()) => {
                            if resume > 0.0 {
                                engine.seek(resume);
                            }
                            engine.set_volume(self.volume);
                            self.session = Some(session);
                            self.coordinator.loaded(sequence, resume);
                            self.report("play", true)
                        }
                        Err(error) => {
                            self.coordinator.failed(sequence, error.to_string());
                            self.status = Some(StatusNotice::message(error.to_string()));
                            Task::none()
                        }
                    }
                }
                Err(error) => {
                    self.coordinator.failed(sequence, error.user_message());
                    self.status = Some(error.into());
                    Task::none()
                }
            },
            Message::PhotoLoaded(sequence, result) => {
                match result {
                    Ok(bytes) if self.coordinator.loaded(sequence, 0.0) => {
                        self.artwork = Some(image::Handle::from_bytes(bytes));
                    }
                    Err(error) => {
                        self.coordinator.failed(sequence, error.user_message());
                        self.status = Some(error.into());
                    }
                    _ => {}
                }
                Task::none()
            }
            Message::ExtrasLoaded(result) => {
                match result {
                    Ok((lyrics, subtitles)) => {
                        self.lyrics = lyrics;
                        self.subtitles = subtitles;
                        self.subtitle = SubtitleChoice::off();
                    }
                    Err(error) => tracing::debug!(%error, "optional media extras unavailable"),
                }
                Task::none()
            }
            Message::Tick => self.tick(),
            Message::Heartbeat => self.heartbeat(),
            Message::HeartbeatFinished(result) => {
                if let Err(error) = result {
                    // Only a lost lease forces a pause; transient failures just surface.
                    if matches!(error, ApiError::PlaybackLeaseLost { .. }) {
                        if let Some(engine) = &self.engine {
                            let _ = engine.pause();
                        }
                        self.coordinator.lease_lost();
                    }
                    self.status = Some(error.into());
                }
                Task::none()
            }
            Message::TogglePlayback => self.toggle_playback(),
            Message::Stop => self.stop(),
            Message::Previous => self.navigate(false),
            Message::Next => self.navigate(true),
            Message::Seek(value) => {
                if let Some(engine) = &self.engine {
                    engine.seek(value);
                }
                self.coordinator.update_position(value);
                Task::none()
            }
            Message::VolumeChanged(value) => {
                self.volume = Volume::new(value);
                self.settings.volume = self.volume;
                if let Some(engine) = &self.engine {
                    engine.set_volume(self.volume);
                }
                let _ = self.store.save(&self.settings);
                Task::none()
            }
            Message::QualityChanged(quality) => self.change_quality(quality),
            Message::FavoriteChanged(liked) => self.set_favorite(liked),
            Message::AddToQueue(next) => self.add_to_queue(next),
            Message::QueuePressed(id) => {
                self.selected_queue = Some(id);
                self.select_queue(id)
            }
            Message::QueueRemove => self.remove_queue(),
            Message::QueueClear => {
                self.queue_action(|client| async move { client.queue_clear().await })
            }
            Message::QueueShuffle => {
                self.queue_action(|client| async move { client.queue_shuffle().await })
            }
            Message::QueueMutated(result) => match result {
                Ok(()) => self.load_queue(),
                Err(error) => {
                    self.status = Some(error.into());
                    Task::none()
                }
            },
            Message::SubtitleChanged(choice) => self.change_subtitle(choice),
            Message::SubtitleDownloaded(result) => {
                match result {
                    Ok(uri) => {
                        if let Some(engine) = &self.engine {
                            engine.set_subtitle_uri(Some(&uri));
                        }
                    }
                    Err(error) => self.status = Some(error.into()),
                }
                Task::none()
            }
            Message::OpenSettings => {
                self.settings_url = self.settings.server_url.to_string();
                self.settings_open = true;
                Task::none()
            }
            Message::CloseSettings => {
                self.settings_open = false;
                Task::none()
            }
            Message::SettingsUrlChanged(value) => {
                self.settings_url = value;
                Task::none()
            }
            Message::AllowHttpChanged(value) => {
                self.allow_http = value;
                Task::none()
            }
            Message::SaveSettings => self.save_settings(),
            Message::DismissStatus => {
                self.status = None;
                Task::none()
            }
            Message::Noop => Task::none(),
        }
    }

    fn view(&self) -> Element<'_, Message> {
        if self.settings_open {
            return views::settings_dialog::render(self);
        }
        views::shell::render(self)
    }

    fn theme(&self) -> Theme {
        let dark = self.settings.color_scheme == ColorScheme::Dark;
        Theme::custom(
            if dark {
                "Dogmedia dark"
            } else {
                "Dogmedia light"
            },
            iced::theme::Palette {
                background: if dark {
                    theme::dark::SURFACE
                } else {
                    theme::light::SURFACE
                },
                text: if dark {
                    theme::dark::INK
                } else {
                    theme::light::INK
                },
                primary: theme::BRAND,
                success: iced::Color::from_rgb8(21, 87, 36),
                warning: iced::Color::from_rgb8(122, 94, 0),
                danger: iced::Color::from_rgb8(190, 18, 60),
            },
        )
    }

    fn subscription(&self) -> Subscription<Message> {
        let active = self.coordinator.snapshot().media.is_some();
        if !active {
            return Subscription::none();
        }
        Subscription::batch([
            time::every(Duration::from_millis(100)).map(|_| Message::Tick),
            time::every(Duration::from_secs(10)).map(|_| Message::Heartbeat),
        ])
    }

    fn connect(&mut self) -> Task<Message> {
        match ApiClient::new(
            self.settings.server_url.as_url().as_str(),
            self.settings.viewer_id.clone(),
        ) {
            Ok(client) => {
                self.client = Some(client.clone());
                self.library.access = AccessView::Checking;
                self.status = Some(StatusNotice::message("Checking server access…"));
                Task::perform(
                    async move { client.check_access().await.map(|_| ()) },
                    Message::AccessChecked,
                )
            }
            Err(error) => {
                self.status = Some(error.into());
                Task::none()
            }
        }
    }

    fn refresh(&mut self) -> Task<Message> {
        let Some(client) = self.client.clone() else {
            return Task::none();
        };
        Task::batch([
            Task::perform(
                {
                    let client = client.clone();
                    async move { client.categories().await }
                },
                Message::CategoriesLoaded,
            ),
            self.begin_browse(),
            self.load_queue(),
        ])
    }

    fn query(&self) -> BrowseQuery {
        BrowseQuery {
            search: self.search.clone(),
            media_type: self.media_filter,
            category_id: self.category.id,
            liked: self.favorites_only,
            cursor: None,
            limit: Limit::new(50),
        }
    }

    fn begin_browse(&mut self) -> Task<Message> {
        let Some(client) = self.client.clone() else {
            return Task::none();
        };
        let query = self.query();
        let generation = self.library.begin_query(query.clone());
        Task::perform(async move { client.browse(&query).await }, move |result| {
            Message::BrowseLoaded(generation, false, result)
        })
    }

    fn load_more(&mut self) -> Task<Message> {
        let Some((generation, query)) = self.library.next_page() else {
            return Task::none();
        };
        let Some(client) = self.client.clone() else {
            return Task::none();
        };
        Task::perform(async move { client.browse(&query).await }, move |result| {
            Message::BrowseLoaded(generation, true, result)
        })
    }

    fn resolve_media(&self, id: MediaId) -> Task<Message> {
        let Some(client) = self.client.clone() else {
            return Task::none();
        };
        if let Some(media) = self.library.items.iter().find(|media| media.id == id) {
            return Task::done(Message::MediaResolved(Ok(media.clone())));
        }
        Task::perform(
            async move { client.media(id).await },
            Message::MediaResolved,
        )
    }

    fn load_media(&mut self, media: Media, start: f64) -> Task<Message> {
        let release = self.release_current();
        self.artwork = None;
        self.lyrics.clear();
        self.subtitles.clear();
        self.subtitle = SubtitleChoice::off();
        let sequence = {
            self.coordinator.load(media.clone());
            self.coordinator.snapshot().sequence
        };
        let Some(client) = self.client.clone() else {
            return release;
        };
        let media_id = media.id;
        let load = if media.is_photo() {
            Task::perform(async move { client.photo(media_id).await }, move |result| {
                Message::PhotoLoaded(sequence, result)
            })
        } else {
            let quality = self.settings.quality;
            Task::perform(
                async move {
                    let resume = if start > 0.0 {
                        start
                    } else {
                        client
                            .resume(media_id)
                            .await
                            .ok()
                            .and_then(|value| value.position)
                            .unwrap_or(0.0)
                    };
                    let session = client.create_playback_session(media_id, quality).await?;
                    let stream = client.absolute_url(&session.stream_url)?;
                    Ok((session, stream, resume))
                },
                move |result| Message::PlaybackPrepared(sequence, result),
            )
        };
        Task::batch([release, load, self.load_extras(media_id)])
    }

    fn load_extras(&self, media_id: MediaId) -> Task<Message> {
        let Some(client) = self.client.clone() else {
            return Task::none();
        };
        Task::perform(
            async move {
                let lyrics = client
                    .lyrics(media_id)
                    .await?
                    .map(|lyrics| {
                        lyrics
                            .segments
                            .into_iter()
                            .map(|segment| segment.text)
                            .collect::<Vec<_>>()
                            .join("\n")
                    })
                    .unwrap_or_default();
                let subtitles = client.subtitles(media_id).await?;
                Ok((lyrics, subtitles))
            },
            Message::ExtrasLoaded,
        )
    }

    fn tick(&mut self) -> Task<Message> {
        let Some(engine) = &self.engine else {
            return Task::none();
        };
        match engine.poll_event() {
            Some(EngineEvent::Ended) => {
                self.coordinator.ended();
                let release = self.release_current();
                return Task::batch([release, self.navigate(true)]);
            }
            Some(EngineEvent::Failed(error)) => {
                let sequence = self.coordinator.snapshot().sequence;
                self.coordinator.failed(sequence, &error);
                self.status = Some(StatusNotice::message(format!("Playback failed: {error}")));
                return self.release_current();
            }
            None => {}
        }
        let position = engine
            .position()
            .unwrap_or(self.coordinator.snapshot().position);
        let duration = engine
            .duration()
            .unwrap_or(self.coordinator.snapshot().duration);
        self.coordinator.update_timing(position, duration);
        if let Some(frame) = engine.take_frame() {
            self.artwork = Some(image::Handle::from_rgba(
                frame.width,
                frame.height,
                frame.pixels,
            ));
        }
        Task::none()
    }

    fn heartbeat(&self) -> Task<Message> {
        let (Some(client), Some(session)) = (self.client.clone(), self.session.clone()) else {
            return Task::none();
        };
        let report = self.report("play", false);
        Task::batch([
            report,
            Task::perform(
                async move { client.heartbeat(&session).await },
                Message::HeartbeatFinished,
            ),
        ])
    }

    fn toggle_playback(&mut self) -> Task<Message> {
        let Some(engine) = &self.engine else {
            return Task::none();
        };
        if self.coordinator.snapshot().status == PlaybackStatus::Playing {
            if engine.pause().is_ok() {
                self.coordinator.pause();
                return self.report("pause", true);
            }
        } else if engine.play().is_ok() {
            self.coordinator.play();
            return self.report("play", true);
        }
        Task::none()
    }

    fn stop(&mut self) -> Task<Message> {
        let report = self.report("pause", true);
        let release = self.release_current();
        self.coordinator.stop();
        self.artwork = None;
        Task::batch([report, release])
    }

    fn release_current(&mut self) -> Task<Message> {
        if let Some(engine) = &self.engine {
            let _ = engine.stop();
        }
        release_task(self.client.clone(), self.session.take())
    }

    fn report(&self, action: &'static str, record_event: bool) -> Task<Message> {
        let (Some(client), Some(media)) = (
            self.client.clone(),
            self.coordinator.snapshot().media.clone(),
        ) else {
            return Task::none();
        };
        let position = self
            .engine
            .as_ref()
            .and_then(PlaybackEngine::position)
            .unwrap_or(self.coordinator.snapshot().position);
        let duration = self
            .engine
            .as_ref()
            .and_then(PlaybackEngine::duration)
            .unwrap_or(self.coordinator.snapshot().duration);
        Task::perform(
            async move {
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
            },
            |_| Message::Noop,
        )
    }

    fn change_quality(&mut self, quality: Quality) -> Task<Message> {
        let media = self.coordinator.snapshot().media.clone();
        let position = self.coordinator.snapshot().position;
        if self.coordinator.set_quality(quality).is_none() {
            return Task::none();
        }
        self.settings.quality = quality;
        let _ = self.store.save(&self.settings);
        media.map_or_else(Task::none, |media| self.load_media(media, position))
    }

    fn set_favorite(&mut self, liked: bool) -> Task<Message> {
        let Some(media) = self.coordinator.snapshot().media.clone() else {
            return Task::none();
        };
        if !media.is_audio() {
            self.status = Some(StatusNotice::message("Only audio items can be favorited."));
            return Task::none();
        }
        let Some(client) = self.client.clone() else {
            return Task::none();
        };
        if let Some(item) = self
            .library
            .items
            .iter_mut()
            .find(|item| item.id == media.id)
        {
            item.liked = liked;
        }
        self.coordinator.set_liked(liked);
        Task::perform(
            async move { client.set_favorite(media.id, liked).await },
            Message::QueueMutated,
        )
    }

    fn load_queue(&self) -> Task<Message> {
        let Some(client) = self.client.clone() else {
            return Task::none();
        };
        Task::perform(
            async move { client.queue_window().await },
            Message::QueueLoaded,
        )
    }

    fn add_to_queue(&self, next: bool) -> Task<Message> {
        let Some(id) = self.current_media_id() else {
            return Task::none();
        };
        self.queue_action(move |client| async move { client.queue_add(id, next).await })
    }

    fn remove_queue(&self) -> Task<Message> {
        let Some(id) = self.selected_queue else {
            return Task::none();
        };
        self.queue_action(move |client| async move { client.queue_remove(id).await })
    }

    fn queue_action<F, Fut>(&self, action: F) -> Task<Message>
    where
        F: FnOnce(ApiClient) -> Fut + Send + 'static,
        Fut: std::future::Future<Output = Result<(), ApiError>> + Send + 'static,
    {
        let Some(client) = self.client.clone() else {
            return Task::none();
        };
        Task::perform(async move { action(client).await }, Message::QueueMutated)
    }

    fn select_queue(&self, id: MediaId) -> Task<Message> {
        let Some(client) = self.client.clone() else {
            return Task::none();
        };
        Task::perform(
            async move {
                client.queue_select(id).await?;
                client.media(id).await
            },
            Message::MediaResolved,
        )
    }

    fn navigate(&self, forward: bool) -> Task<Message> {
        let Some(client) = self.client.clone() else {
            return Task::none();
        };
        Task::perform(
            async move {
                let selection = client.queue_navigate(forward).await?;
                let id = selection.media_id.ok_or(ApiError::QueueEmpty)?;
                client.media(id).await
            },
            Message::MediaResolved,
        )
    }

    fn change_subtitle(&mut self, choice: SubtitleChoice) -> Task<Message> {
        self.subtitle = choice.clone();
        let Some(index) = choice.index else {
            if let Some(engine) = &self.engine {
                engine.set_subtitle_uri(None);
            }
            return Task::none();
        };
        let (Some(track), Some(media_id), Some(client)) = (
            self.subtitles.get(index).cloned(),
            self.current_media_id(),
            self.client.clone(),
        ) else {
            return Task::none();
        };
        Task::perform(
            async move {
                let (path, extension) = track.preferred_url();
                let bytes = client.subtitle_file(path).await?;
                let target = subtitle_cache_path(media_id, track.id, extension)
                    .map_err(|error| ApiError::Unreachable(error.to_string()))?;
                std::fs::write(&target, bytes)
                    .map_err(|error| ApiError::Unreachable(error.to_string()))?;
                url::Url::from_file_path(target)
                    .map(|url| url.to_string())
                    .map_err(|_| {
                        ApiError::Malformed("Unable to create the subtitle file URL.".into())
                    })
            },
            Message::SubtitleDownloaded,
        )
    }

    fn save_settings(&mut self) -> Task<Message> {
        let mut candidate = self.settings.clone();
        match candidate.set_server_url(&self.settings_url) {
            Ok(true) if !self.allow_http => {
                self.status = Some(StatusNotice::message(
                    "Plain HTTP requires the trusted-LAN confirmation.",
                ));
                Task::none()
            }
            Ok(_) => {
                if let Err(error) = self.store.save(&candidate) {
                    self.status = Some(StatusNotice::message(error.to_string()));
                    return Task::none();
                }
                self.settings = candidate;
                self.settings_open = false;
                self.connect()
            }
            Err(error) => {
                self.status = Some(StatusNotice::message(error.to_string()));
                Task::none()
            }
        }
    }

    pub(crate) fn current_media_id(&self) -> Option<MediaId> {
        self.coordinator
            .snapshot()
            .media
            .as_ref()
            .map(|media| media.id)
    }

    pub(crate) fn category_choices(&self) -> Vec<CategoryChoice> {
        std::iter::once(CategoryChoice::all())
            .chain(self.categories.iter().map(|category| CategoryChoice {
                id: Some(category.id),
                label: format!("{}{}", "  ".repeat(category.depth as usize), category.name),
            }))
            .collect()
    }

    pub(crate) fn subtitle_choices(&self) -> Vec<SubtitleChoice> {
        std::iter::once(SubtitleChoice::off())
            .chain(self.subtitles.iter().enumerate().map(|(index, track)| {
                SubtitleChoice {
                    index: Some(index),
                    label: track
                        .title
                        .clone()
                        .or_else(|| track.language.clone())
                        .unwrap_or_else(|| "Subtitle".into()),
                }
            }))
            .collect()
    }
}

fn release_task(client: Option<ApiClient>, session: Option<PlaybackSession>) -> Task<Message> {
    let (Some(client), Some(session)) = (client, session) else {
        return Task::none();
    };
    Task::perform(
        async move {
            let _ = client.release(&session).await;
        },
        |_| Message::Noop,
    )
}
