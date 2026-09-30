use std::{cell::RefCell, rc::Rc, sync::Arc, time::Duration};

use adw::prelude::*;
use gtk::glib;
use tokio::runtime::Runtime;

use crate::{
    api::{ApiClient, ApiError},
    app::{AccessView, AppState},
    domain::{
        BrowseQuery, Category, Media, MediaFilter, PlaybackReport, PlaybackSession, Quality,
        SubtitleTrack,
    },
    playback::{EngineEvent, PlaybackCoordinator, PlaybackEngine, PlaybackStatus},
    store::{Settings, SettingsStore, subtitle_cache_path},
};

use super::{browse, player, queue, settings};

pub fn build_window(application: &adw::Application) -> adw::ApplicationWindow {
    let settings_store = SettingsStore::discover().expect("XDG config directory is required");
    let stored = settings_store.load().unwrap_or_else(|error| {
        tracing::warn!(%error, "using default desktop settings");
        Settings::default()
    });
    let window = adw::ApplicationWindow::builder()
        .application(application)
        .title("Dogmedia")
        .default_width(stored.window_width)
        .default_height(stored.window_height)
        .build();

    let toolbar = adw::ToolbarView::new();
    let header = adw::HeaderBar::new();
    let settings_button = gtk::Button::builder()
        .icon_name("emblem-system-symbolic")
        .tooltip_text("Server settings")
        .build();
    let refresh = gtk::Button::builder()
        .icon_name("view-refresh-symbolic")
        .tooltip_text("Refresh library")
        .build();
    header.pack_start(&refresh);
    header.pack_end(&settings_button);
    toolbar.add_top_bar(&header);

    let browse = browse::build();
    let player = player::build();
    let queue = queue::build();
    let content = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    content.append(&browse.root);
    browse.root.set_hexpand(true);
    content.append(&queue.root);

    let main = gtk::Box::new(gtk::Orientation::Vertical, 0);
    let status = gtk::Label::builder()
        .label("Configure a Dogmedia server to begin")
        .wrap(true)
        .margin_top(24)
        .margin_bottom(24)
        .margin_start(24)
        .margin_end(24)
        .build();
    status.add_css_class("access-message");
    main.append(&status);
    main.append(&content);
    main.append(&player.root);
    content.set_vexpand(true);
    toolbar.set_content(Some(&main));
    window.set_content(Some(&toolbar));

    let runtime = Arc::new(Runtime::new().expect("Tokio runtime must start"));
    let engine = PlaybackEngine::new().ok();
    if engine.is_none() {
        status.set_label(
            "GStreamer playback is unavailable. Install the GTK4 GStreamer sink and codecs.",
        );
    }
    let controller = Rc::new(Controller {
        window: window.clone(),
        runtime,
        settings_store,
        settings: RefCell::new(stored),
        client: RefCell::new(None),
        state: RefCell::new(AppState::default()),
        categories: RefCell::new(Vec::new()),
        browse,
        player,
        queue,
        status,
        coordinator: RefCell::new(PlaybackCoordinator::default()),
        engine,
        session: RefCell::new(None),
        subtitles: RefCell::new(Vec::new()),
        search_timer: RefCell::new(None),
        heartbeat_timer: RefCell::new(None),
        playback_timer: RefCell::new(None),
    });
    Controller::wire(&controller, settings_button, refresh);
    controller.configure_client();
    // The value is owned by the GObject and dropped with the window. The key is
    // static and no other code reads or replaces this entry.
    unsafe { window.set_data("dogmedia-controller", controller) };
    window
}

struct Controller {
    window: adw::ApplicationWindow,
    runtime: Arc<Runtime>,
    settings_store: SettingsStore,
    settings: RefCell<Settings>,
    client: RefCell<Option<ApiClient>>,
    state: RefCell<AppState>,
    categories: RefCell<Vec<Category>>,
    browse: browse::BrowseView,
    player: player::PlayerView,
    queue: queue::QueueView,
    status: gtk::Label,
    coordinator: RefCell<PlaybackCoordinator>,
    engine: Option<PlaybackEngine>,
    session: RefCell<Option<PlaybackSession>>,
    subtitles: RefCell<Vec<SubtitleTrack>>,
    search_timer: RefCell<Option<glib::SourceId>>,
    heartbeat_timer: RefCell<Option<glib::SourceId>>,
    playback_timer: RefCell<Option<glib::SourceId>>,
}

impl Controller {
    fn wire(this: &Rc<Self>, settings_button: gtk::Button, refresh: gtk::Button) {
        let weak = Rc::downgrade(this);
        settings_button.connect_clicked(move |_| {
            let Some(this) = weak.upgrade() else { return };
            let weak = Rc::downgrade(&this);
            settings::present(
                &this.window,
                &this.settings.borrow().server_url.clone(),
                move |url, allow_http| {
                    if let Some(this) = weak.upgrade() {
                        this.save_server(url, allow_http);
                    }
                },
            );
        });
        let weak = Rc::downgrade(this);
        refresh.connect_clicked(move |_| {
            if let Some(this) = weak.upgrade() {
                this.refresh_all();
            }
        });
        let weak = Rc::downgrade(this);
        this.browse.search.connect_search_changed(move |_| {
            let Some(this) = weak.upgrade() else { return };
            if let Some(timer) = this.search_timer.borrow_mut().take() {
                timer.remove();
            }
            let weak = Rc::downgrade(&this);
            *this.search_timer.borrow_mut() = Some(glib::timeout_add_local_once(
                Duration::from_millis(350),
                move || {
                    if let Some(this) = weak.upgrade() {
                        this.begin_browse();
                    }
                },
            ));
        });
        for signal in [
            this.browse.media_type.clone().upcast::<gtk::Widget>(),
            this.browse.categories.clone().upcast(),
            this.browse.favorites.clone().upcast(),
        ] {
            let _ = signal;
        }
        let weak = Rc::downgrade(this);
        this.browse.media_type.connect_selected_notify(move |_| {
            if let Some(this) = weak.upgrade() {
                this.begin_browse();
            }
        });
        let weak = Rc::downgrade(this);
        this.browse.categories.connect_selected_notify(move |_| {
            if let Some(this) = weak.upgrade() {
                this.begin_browse();
            }
        });
        let weak = Rc::downgrade(this);
        this.browse.favorites.connect_toggled(move |_| {
            if let Some(this) = weak.upgrade() {
                this.begin_browse();
            }
        });
        let weak = Rc::downgrade(this);
        this.browse.list.connect_activate(move |_, position| {
            let Some(this) = weak.upgrade() else { return };
            let media = this.state.borrow().items.get(position as usize).cloned();
            if let Some(media) = media {
                this.load_media(media, 0.0);
            }
        });
        let adjustment = this.browse.scroll.vadjustment();
        let weak = Rc::downgrade(this);
        adjustment.connect_value_changed(move |adjustment| {
            if adjustment.value() + adjustment.page_size() >= adjustment.upper() - 120.0
                && let Some(this) = weak.upgrade()
            {
                this.next_page();
            }
        });
        let weak = Rc::downgrade(this);
        this.player.play.connect_clicked(move |_| {
            if let Some(this) = weak.upgrade() {
                this.toggle_play();
            }
        });
        let weak = Rc::downgrade(this);
        this.player.stop.connect_clicked(move |_| {
            if let Some(this) = weak.upgrade() {
                this.stop_playback();
            }
        });
        let weak = Rc::downgrade(this);
        this.player.previous.connect_clicked(move |_| {
            if let Some(this) = weak.upgrade() {
                this.navigate_queue(false);
            }
        });
        let weak = Rc::downgrade(this);
        this.player.next.connect_clicked(move |_| {
            if let Some(this) = weak.upgrade() {
                this.navigate_queue(true);
            }
        });
        let weak = Rc::downgrade(this);
        this.player
            .position
            .connect_change_value(move |_, _, value| {
                if let Some(this) = weak.upgrade() {
                    this.seek(value);
                }
                glib::Propagation::Proceed
            });
        let weak = Rc::downgrade(this);
        this.player.volume.connect_value_changed(move |scale| {
            if let Some(this) = weak.upgrade() {
                if let Some(engine) = &this.engine {
                    engine.set_volume(scale.value());
                }
            }
        });
        let weak = Rc::downgrade(this);
        this.player
            .quality
            .connect_selected_notify(move |drop_down| {
                if let Some(this) = weak.upgrade() {
                    let quality = quality_at(drop_down.selected());
                    this.change_quality(quality);
                }
            });
        let weak = Rc::downgrade(this);
        this.player.favorite.connect_toggled(move |button| {
            if let Some(this) = weak.upgrade() {
                this.set_favorite(button.is_active());
            }
        });
        let weak = Rc::downgrade(this);
        this.player.add_queue.connect_clicked(move |_| {
            if let Some(this) = weak.upgrade() {
                this.add_current(false);
            }
        });
        let weak = Rc::downgrade(this);
        this.player.play_next.connect_clicked(move |_| {
            if let Some(this) = weak.upgrade() {
                this.add_current(true);
            }
        });
        let weak = Rc::downgrade(this);
        this.queue.remove.connect_clicked(move |_| {
            if let Some(this) = weak.upgrade() {
                this.remove_selected_queue();
            }
        });
        let weak = Rc::downgrade(this);
        this.queue.clear.connect_clicked(move |_| {
            if let Some(this) = weak.upgrade() {
                this.clear_queue();
            }
        });
        let weak = Rc::downgrade(this);
        this.queue.shuffle.connect_clicked(move |_| {
            if let Some(this) = weak.upgrade() {
                this.shuffle_queue();
            }
        });
        let weak = Rc::downgrade(this);
        this.queue.list.connect_activate(move |_, position| {
            if let Some(this) = weak.upgrade() {
                this.select_queue(position);
            }
        });
        let weak = Rc::downgrade(this);
        this.player
            .subtitles
            .connect_selected_notify(move |drop_down| {
                if let Some(this) = weak.upgrade() {
                    this.select_subtitle(drop_down.selected());
                }
            });
        let weak = Rc::downgrade(this);
        this.window.connect_close_request(move |window| {
            if let Some(this) = weak.upgrade() {
                this.shutdown();
                let mut settings = this.settings.borrow().clone();
                settings.window_width = window.width();
                settings.window_height = window.height();
                let _ = this.settings_store.save(&settings);
            }
            glib::Propagation::Proceed
        });
    }

    fn save_server(self: &Rc<Self>, url: String, allow_http: bool) {
        let mut settings = self.settings.borrow().clone();
        match settings.set_server_url(&url) {
            Ok(true) if !allow_http => {
                self.show_error("Plain HTTP requires confirming the trusted-LAN option.")
            }
            Ok(_) => {
                if let Err(error) = self.settings_store.save(&settings) {
                    self.show_error(&error.to_string());
                    return;
                }
                *self.settings.borrow_mut() = settings;
                self.configure_client();
            }
            Err(error) => self.show_error(&error.to_string()),
        }
    }

    fn configure_client(self: &Rc<Self>) {
        let settings = self.settings.borrow().clone();
        if !settings.configured {
            self.status.set_visible(true);
            self.state.borrow_mut().access = AccessView::FirstRun;
            return;
        }
        match ApiClient::new(&settings.server_url, settings.viewer_id) {
            Ok(client) => {
                *self.client.borrow_mut() = Some(client);
                self.check_access();
            }
            Err(error) => self.show_error(&error.to_string()),
        }
    }

    fn check_access(self: &Rc<Self>) {
        let Some(client) = self.client.borrow().clone() else {
            return;
        };
        self.status.set_label("Checking server access…");
        self.status.set_visible(true);
        self.state.borrow_mut().access = AccessView::Checking;
        let weak = Rc::downgrade(self);
        self.spawn(async move { client.check_access().await }, move |result| {
            let Some(this) = weak.upgrade() else { return };
            match result {
                Ok(_) => {
                    this.state.borrow_mut().access = AccessView::Ready;
                    this.status.set_visible(false);
                    this.refresh_all();
                }
                Err(ApiError::AccessDenied) => {
                    this.state.borrow_mut().access = AccessView::Denied;
                    this.status
                        .set_label("This computer's IP address is not allowed by the server.");
                }
                Err(error) => {
                    this.state.borrow_mut().access = AccessView::Unreachable(error.to_string());
                    this.status
                        .set_label(&format!("Unable to reach the server: {error}"));
                }
            }
        });
    }

    fn refresh_all(self: &Rc<Self>) {
        self.load_categories();
        self.begin_browse();
        self.refresh_queue();
    }

    fn load_categories(self: &Rc<Self>) {
        let Some(client) = self.client.borrow().clone() else {
            return;
        };
        let weak = Rc::downgrade(self);
        self.spawn(async move { client.categories().await }, move |result| {
            if let Some(this) = weak.upgrade() {
                match result {
                    Ok(categories) => {
                        this.browse.set_categories(&categories);
                        *this.categories.borrow_mut() = categories;
                    }
                    Err(error) => this.show_error(&error.to_string()),
                }
            }
        });
    }

    fn query(&self) -> BrowseQuery {
        let category = self
            .browse
            .categories
            .selected()
            .checked_sub(1)
            .and_then(|index| {
                self.categories
                    .borrow()
                    .get(index as usize)
                    .map(|item| item.id)
            });
        BrowseQuery {
            search: self.browse.search.text().to_string(),
            media_type: match self.browse.media_type.selected() {
                1 => MediaFilter::Audio,
                2 => MediaFilter::Video,
                3 => MediaFilter::Photo,
                _ => MediaFilter::All,
            },
            category_id: category,
            liked: self.browse.favorites.is_active(),
            cursor: None,
            limit: 50,
        }
    }

    fn begin_browse(self: &Rc<Self>) {
        let Some(client) = self.client.borrow().clone() else {
            return;
        };
        let query = self.query();
        let generation = self.state.borrow_mut().begin_query(query.clone());
        self.browse.spinner.start();
        let weak = Rc::downgrade(self);
        self.spawn(async move { client.browse(&query).await }, move |result| {
            if let Some(this) = weak.upgrade() {
                match result {
                    Ok(page) => {
                        if this.state.borrow_mut().apply_page(generation, page, false) {
                            this.browse.set_items(&this.state.borrow().items);
                        }
                    }
                    Err(error) if this.state.borrow_mut().fail(generation) => {
                        this.show_error(&error.to_string())
                    }
                    _ => {}
                }
                if !this.state.borrow().loading {
                    this.browse.spinner.stop();
                }
            }
        });
    }

    fn next_page(self: &Rc<Self>) {
        let Some((generation, query)) = self.state.borrow_mut().next_page() else {
            return;
        };
        let Some(client) = self.client.borrow().clone() else {
            return;
        };
        self.browse.spinner.start();
        let weak = Rc::downgrade(self);
        self.spawn(async move { client.browse(&query).await }, move |result| {
            if let Some(this) = weak.upgrade() {
                match result {
                    Ok(page) => {
                        if this.state.borrow_mut().apply_page(generation, page, true) {
                            this.browse.set_items(&this.state.borrow().items);
                        }
                    }
                    Err(error) if this.state.borrow_mut().fail(generation) => {
                        this.show_error(&error.to_string())
                    }
                    _ => {}
                }
                if !this.state.borrow().loading {
                    this.browse.spinner.stop();
                }
            }
        });
    }

    fn load_media(self: &Rc<Self>, media: Media, start: f64) {
        self.release_current();
        let sequence = {
            let mut coordinator = self.coordinator.borrow_mut();
            coordinator.load(media.clone());
            coordinator.snapshot().sequence
        };
        self.player.title.set_label(media.title());
        self.player.favorite.set_active(media.liked);
        self.player
            .position
            .set_range(0.0, media.duration.unwrap_or(1.0).max(1.0));
        self.player
            .picture
            .set_visible(media.is_photo() || media.is_video());
        self.player.lyrics.set_visible(false);
        self.player.subtitle_model.splice(
            0,
            self.player.subtitle_model.n_items(),
            &["Subtitles off"],
        );
        self.subtitles.borrow_mut().clear();
        let Some(client) = self.client.borrow().clone() else {
            return;
        };
        if media.is_photo() {
            let weak = Rc::downgrade(self);
            let media_id = media.id;
            self.spawn(async move { client.photo(media_id).await }, move |result| {
                if let Some(this) = weak.upgrade() {
                    match result.and_then(|bytes| {
                        gtk::gdk::Texture::from_bytes(&glib::Bytes::from_owned(bytes))
                            .map_err(|error| ApiError::Malformed(error.to_string()))
                    }) {
                        Ok(texture) if this.coordinator.borrow_mut().loaded(sequence, 0.0) => {
                            this.player.picture.set_paintable(Some(&texture))
                        }
                        Err(error) => {
                            this.coordinator
                                .borrow_mut()
                                .failed(sequence, error.to_string());
                            this.show_error(&error.to_string());
                        }
                        _ => {}
                    }
                }
            });
            return;
        }
        let quality = self.settings.borrow().quality;
        let weak = Rc::downgrade(self);
        let media_id = media.id;
        self.spawn(
            async move {
                let resume_position = if start > 0.0 {
                    start
                } else {
                    client
                        .resume(media_id)
                        .await
                        .ok()
                        .and_then(|resume| resume.position)
                        .unwrap_or(0.0)
                };
                let session = client.create_playback_session(media_id, quality).await?;
                let stream = client.absolute_url(&session.stream_url)?.to_string();
                Ok::<_, ApiError>((session, stream, resume_position))
            },
            move |result| {
                let Some(this) = weak.upgrade() else { return };
                if this.coordinator.borrow().snapshot().sequence != sequence {
                    return;
                }
                match result {
                    Ok((session, stream, resume_position)) => {
                        let Some(engine) = &this.engine else {
                            this.show_error("GStreamer playback is unavailable");
                            return;
                        };
                        if let Err(error) =
                            engine.open(&session, &stream).and_then(|_| engine.play())
                        {
                            this.coordinator
                                .borrow_mut()
                                .failed(sequence, error.to_string());
                            this.show_error(&error.to_string());
                            return;
                        }
                        if resume_position > 0.0 {
                            engine.seek(resume_position);
                        }
                        engine.set_volume(this.player.volume.value());
                        if let Some(paintable) = engine.paintable() {
                            this.player.picture.set_paintable(Some(&paintable));
                        }
                        *this.session.borrow_mut() = Some(session);
                        this.coordinator
                            .borrow_mut()
                            .loaded(sequence, resume_position);
                        this.player
                            .play
                            .set_icon_name("media-playback-pause-symbolic");
                        this.start_heartbeat();
                        this.start_playback_timer();
                        this.load_extras(media_id);
                        this.report_current("play", true);
                    }
                    Err(error) => {
                        this.coordinator
                            .borrow_mut()
                            .failed(sequence, error.to_string());
                        this.show_error(&error.to_string());
                    }
                }
            },
        );
    }

    fn load_extras(self: &Rc<Self>, media_id: i64) {
        let Some(client) = self.client.borrow().clone() else {
            return;
        };
        let weak = Rc::downgrade(self);
        self.spawn(
            async move { client.lyrics(media_id).await },
            move |result| {
                if let (Some(this), Ok(Some(lyrics))) = (weak.upgrade(), result) {
                    let text = lyrics
                        .segments
                        .iter()
                        .map(|segment| segment.text.as_str())
                        .collect::<Vec<_>>()
                        .join("\n");
                    this.player.lyrics.set_label(&text);
                    this.player.lyrics.set_visible(!text.is_empty());
                }
            },
        );
        let Some(client) = self.client.borrow().clone() else {
            return;
        };
        let weak = Rc::downgrade(self);
        self.spawn(
            async move { client.subtitles(media_id).await },
            move |result| {
                if let (Some(this), Ok(tracks)) = (weak.upgrade(), result) {
                    let labels: Vec<String> = std::iter::once("Subtitles off".to_owned())
                        .chain(tracks.iter().map(|track| {
                            track
                                .title
                                .clone()
                                .or(track.language.clone())
                                .unwrap_or_else(|| "Subtitle".into())
                        }))
                        .collect();
                    let refs: Vec<&str> = labels.iter().map(String::as_str).collect();
                    this.player.subtitle_model.splice(
                        0,
                        this.player.subtitle_model.n_items(),
                        &refs,
                    );
                    *this.subtitles.borrow_mut() = tracks;
                }
            },
        );
    }

    fn select_subtitle(self: &Rc<Self>, selected: u32) {
        let Some(engine) = &self.engine else { return };
        if selected == 0 {
            engine.set_subtitle_uri(None);
            return;
        }
        let Some(track) = self.subtitles.borrow().get(selected as usize - 1).cloned() else {
            return;
        };
        let media_id = self
            .coordinator
            .borrow()
            .snapshot()
            .media
            .as_ref()
            .map(|media| media.id);
        let (path, extension) = track.preferred_url();
        let (Some(client), Some(media_id)) = (self.client.borrow().clone(), media_id) else {
            return;
        };
        let path = path.to_owned();
        let weak = Rc::downgrade(self);
        self.spawn(
            async move {
                let bytes = client.subtitle_file(&path).await?;
                let target = subtitle_cache_path(media_id, track.id, extension)
                    .map_err(|error| ApiError::Unreachable(error.to_string()))?;
                std::fs::write(&target, bytes)
                    .map_err(|error| ApiError::Unreachable(error.to_string()))?;
                Ok::<_, ApiError>(target)
            },
            move |result| {
                if let Some(this) = weak.upgrade() {
                    match result {
                        Ok(path) => {
                            if let (Some(engine), Some(uri)) =
                                (&this.engine, glib::filename_to_uri(path, None).ok())
                            {
                                engine.set_subtitle_uri(Some(uri.as_str()));
                            }
                        }
                        Err(error) => this.show_error(&error.to_string()),
                    }
                }
            },
        );
    }

    fn toggle_play(&self) {
        let Some(engine) = &self.engine else { return };
        let status = self.coordinator.borrow().snapshot().status;
        if status == PlaybackStatus::Playing {
            if engine.pause().is_ok() {
                self.coordinator.borrow_mut().pause();
                self.player
                    .play
                    .set_icon_name("media-playback-start-symbolic");
                self.report_current("pause", true);
            }
        } else if engine.play().is_ok() {
            self.coordinator.borrow_mut().play();
            self.player
                .play
                .set_icon_name("media-playback-pause-symbolic");
            self.report_current("play", true);
        }
    }

    fn seek(&self, value: f64) {
        if let Some(engine) = &self.engine {
            engine.seek(value);
        }
        self.coordinator.borrow_mut().update_position(value);
        let action = if self.coordinator.borrow().snapshot().status == PlaybackStatus::Playing {
            "play"
        } else {
            "pause"
        };
        self.report_current(action, false);
    }

    fn change_quality(self: &Rc<Self>, quality: Quality) {
        let current = self.coordinator.borrow().snapshot().media.clone();
        let position = self
            .engine
            .as_ref()
            .and_then(PlaybackEngine::position)
            .unwrap_or(0.0);
        if self.coordinator.borrow_mut().set_quality(quality).is_none() {
            return;
        }
        self.settings.borrow_mut().quality = quality;
        let _ = self.settings_store.save(&self.settings.borrow());
        if let Some(media) = current {
            self.load_media(media, position);
        }
    }

    fn stop_playback(&self) {
        self.report_current("pause", true);
        self.release_current();
        self.coordinator.borrow_mut().stop();
        self.player
            .play
            .set_icon_name("media-playback-start-symbolic");
    }

    fn release_current(&self) {
        if let Some(timer) = self.heartbeat_timer.borrow_mut().take() {
            timer.remove();
        }
        if let Some(timer) = self.playback_timer.borrow_mut().take() {
            timer.remove();
        }
        if let Some(engine) = &self.engine {
            let _ = engine.stop();
        }
        let Some(session) = self.session.borrow_mut().take() else {
            return;
        };
        let Some(client) = self.client.borrow().clone() else {
            return;
        };
        self.runtime.spawn(async move {
            let _ = client.release(&session).await;
        });
    }

    fn start_heartbeat(self: &Rc<Self>) {
        if let Some(timer) = self.heartbeat_timer.borrow_mut().take() {
            timer.remove();
        }
        let weak = Rc::downgrade(self);
        *self.heartbeat_timer.borrow_mut() = Some(glib::timeout_add_local(
            Duration::from_secs(10),
            move || {
                let Some(this) = weak.upgrade() else {
                    return glib::ControlFlow::Break;
                };
                let (Some(client), Some(session)) =
                    (this.client.borrow().clone(), this.session.borrow().clone())
                else {
                    return glib::ControlFlow::Break;
                };
                let weak = Rc::downgrade(&this);
                this.spawn(
                    async move { client.heartbeat(&session).await },
                    move |result| {
                        if let (Some(this), Err(error)) = (weak.upgrade(), result) {
                            if matches!(error, ApiError::PlaybackLeaseLost { .. }) {
                                if let Some(engine) = &this.engine {
                                    let _ = engine.pause();
                                }
                                this.coordinator.borrow_mut().lease_lost();
                                this.show_error(&error.to_string());
                            }
                        }
                    },
                );
                let action =
                    if this.coordinator.borrow().snapshot().status == PlaybackStatus::Playing {
                        "play"
                    } else {
                        "pause"
                    };
                this.report_current(action, false);
                glib::ControlFlow::Continue
            },
        ));
    }

    fn start_playback_timer(self: &Rc<Self>) {
        if let Some(timer) = self.playback_timer.borrow_mut().take() {
            timer.remove();
        }
        let weak = Rc::downgrade(self);
        *self.playback_timer.borrow_mut() = Some(glib::timeout_add_local(
            Duration::from_millis(500),
            move || {
                let Some(this) = weak.upgrade() else {
                    return glib::ControlFlow::Break;
                };
                let Some(engine) = &this.engine else {
                    return glib::ControlFlow::Break;
                };
                match engine.poll_event() {
                    Some(EngineEvent::Ended) => {
                        let duration = engine
                            .duration()
                            .unwrap_or(this.coordinator.borrow().snapshot().duration);
                        this.coordinator
                            .borrow_mut()
                            .update_timing(duration, duration);
                        this.player.position.set_range(0.0, duration.max(1.0));
                        this.player.position.set_value(duration);
                        this.coordinator.borrow_mut().ended();
                        this.player
                            .play
                            .set_icon_name("media-playback-start-symbolic");
                        // The current callback is already returning Break, so clear its
                        // stored ID before release_current tries to remove it.
                        let _ = this.playback_timer.borrow_mut().take();
                        this.release_current();
                        this.finish_and_navigate_after_end();
                        return glib::ControlFlow::Break;
                    }
                    Some(EngineEvent::Failed(message)) => {
                        let sequence = this.coordinator.borrow().snapshot().sequence;
                        this.coordinator.borrow_mut().failed(sequence, &message);
                        this.player
                            .play
                            .set_icon_name("media-playback-start-symbolic");
                        let _ = this.playback_timer.borrow_mut().take();
                        this.release_current();
                        this.show_error(&format!("Playback failed: {message}"));
                        return glib::ControlFlow::Break;
                    }
                    None => {}
                }
                let position = engine.position().unwrap_or(0.0);
                let duration = engine
                    .duration()
                    .unwrap_or(this.coordinator.borrow().snapshot().duration);
                this.coordinator
                    .borrow_mut()
                    .update_timing(position, duration);
                this.player.position.set_range(0.0, duration.max(1.0));
                this.player
                    .position
                    .set_value(position.min(duration.max(1.0)));
                glib::ControlFlow::Continue
            },
        ));
    }

    fn report_current(&self, action: &'static str, record_event: bool) {
        let Some(client) = self.client.borrow().clone() else {
            return;
        };
        let snapshot = self.coordinator.borrow().snapshot().clone();
        let Some(media) = snapshot.media else { return };
        let position = self
            .engine
            .as_ref()
            .and_then(PlaybackEngine::position)
            .unwrap_or(snapshot.position);
        let duration = self
            .engine
            .as_ref()
            .and_then(PlaybackEngine::duration)
            .unwrap_or(snapshot.duration);
        self.runtime.spawn(async move {
            let media_type = media
                .mime_type
                .as_deref()
                .unwrap_or("application/octet-stream");
            let report = PlaybackReport {
                media_id: media.id,
                action,
                position,
                duration,
                media_type,
                title: media.title(),
                artists: media.artists.as_deref(),
                source: "desktop",
            };
            let _ = client.save_resume(media.id, position, duration).await;
            let _ = client.report("api/playback/active", &report).await;
            if record_event {
                let _ = client.report("api/playback/event", &report).await;
            }
        });
    }

    fn current_media_id(&self) -> Option<i64> {
        self.coordinator
            .borrow()
            .snapshot()
            .media
            .as_ref()
            .map(|media| media.id)
    }

    fn set_favorite(self: &Rc<Self>, liked: bool) {
        let Some(media) = self.coordinator.borrow().snapshot().media.clone() else {
            return;
        };
        if !media.is_audio() {
            self.player.favorite.set_active(false);
            self.show_error("Only audio items can be favorited.");
            return;
        }
        let Some(client) = self.client.borrow().clone() else {
            return;
        };
        let weak = Rc::downgrade(self);
        self.spawn(
            async move { client.set_favorite(media.id, liked).await },
            move |result| {
                if let (Some(this), Err(error)) = (weak.upgrade(), result) {
                    this.show_error(&error.to_string());
                }
            },
        );
    }

    fn add_current(self: &Rc<Self>, play_next: bool) {
        let Some(media_id) = self.current_media_id() else {
            return;
        };
        let Some(client) = self.client.borrow().clone() else {
            return;
        };
        let weak = Rc::downgrade(self);
        self.spawn(
            async move { client.queue_add(media_id, play_next).await },
            move |result| {
                if let Some(this) = weak.upgrade() {
                    match result {
                        Ok(()) => this.refresh_queue(),
                        Err(error) => this.show_error(&error.to_string()),
                    }
                }
            },
        );
    }

    fn refresh_queue(self: &Rc<Self>) {
        let Some(client) = self.client.borrow().clone() else {
            return;
        };
        let weak = Rc::downgrade(self);
        self.spawn(async move { client.queue_window().await }, move |result| {
            if let Some(this) = weak.upgrade() {
                match result {
                    Ok(window) => this.queue.set_window(&window),
                    Err(error) => this.show_error(&error.to_string()),
                }
            }
        });
    }

    fn remove_selected_queue(self: &Rc<Self>) {
        let index = self.queue.selection.selected();
        if index == gtk::INVALID_LIST_POSITION {
            return;
        }
        let Some(client) = self.client.borrow().clone() else {
            return;
        };
        let weak = Rc::downgrade(self);
        self.spawn(
            async move {
                let window = client.queue_window().await?;
                let Some(item) = window.items.get(index as usize) else {
                    return Ok(());
                };
                client.queue_remove(item.media.id).await
            },
            move |result| {
                if let Some(this) = weak.upgrade() {
                    match result {
                        Ok(()) => this.refresh_queue(),
                        Err(error) => this.show_error(&error.to_string()),
                    }
                }
            },
        );
    }

    fn clear_queue(self: &Rc<Self>) {
        let Some(client) = self.client.borrow().clone() else {
            return;
        };
        let weak = Rc::downgrade(self);
        self.spawn(async move { client.queue_clear().await }, move |result| {
            if let Some(this) = weak.upgrade() {
                match result {
                    Ok(()) => this.refresh_queue(),
                    Err(error) => this.show_error(&error.to_string()),
                }
            }
        });
    }

    fn shuffle_queue(self: &Rc<Self>) {
        let Some(client) = self.client.borrow().clone() else {
            return;
        };
        let weak = Rc::downgrade(self);
        self.spawn(async move { client.queue_shuffle().await }, move |result| {
            if let Some(this) = weak.upgrade() {
                match result {
                    Ok(()) => this.refresh_queue(),
                    Err(error) => this.show_error(&error.to_string()),
                }
            }
        });
    }

    fn select_queue(self: &Rc<Self>, position: u32) {
        let Some(media_id) = self.queue.media_id_at(position) else {
            return;
        };
        let Some(client) = self.client.borrow().clone() else {
            return;
        };
        let weak = Rc::downgrade(self);
        self.spawn(
            async move {
                let selected = client.queue_select(media_id).await?;
                match selected.media_id {
                    Some(id) => Ok(Some(client.media(id).await?)),
                    None => Ok(None),
                }
            },
            move |result: Result<Option<Media>, ApiError>| {
                if let Some(this) = weak.upgrade() {
                    match result {
                        Ok(Some(media)) => {
                            this.refresh_queue();
                            this.load_media(media, 0.0);
                        }
                        Ok(None) => this.refresh_queue(),
                        Err(error) => this.show_error(&error.to_string()),
                    }
                }
            },
        );
    }

    fn finish_and_navigate_after_end(self: &Rc<Self>) {
        let Some(client) = self.client.borrow().clone() else {
            return;
        };
        let snapshot = self.coordinator.borrow().snapshot().clone();
        let Some(media) = snapshot.media else { return };
        let weak = Rc::downgrade(self);
        self.spawn(
            async move {
                let media_type = media
                    .mime_type
                    .as_deref()
                    .unwrap_or("application/octet-stream");
                let report = PlaybackReport {
                    media_id: media.id,
                    action: "end",
                    position: snapshot.position,
                    duration: snapshot.duration,
                    media_type,
                    title: media.title(),
                    artists: media.artists.as_deref(),
                    source: "desktop",
                };
                // Finish the old item before the next one reports itself active.
                // This prevents a late end report from clearing the new item.
                let _ = client
                    .save_resume(media.id, snapshot.position, snapshot.duration)
                    .await;
                let _ = client.report("api/playback/active", &report).await;
                let _ = client.report("api/playback/event", &report).await;
                let window = client.queue_window().await?;
                if window.current_index + 1 >= window.total {
                    return Ok(None);
                }
                let selected = client.queue_navigate(true).await?;
                match selected.media_id {
                    Some(id) => Ok(Some(client.media(id).await?)),
                    None => Ok(None),
                }
            },
            move |result: Result<Option<Media>, ApiError>| {
                if let Some(this) = weak.upgrade() {
                    match result {
                        Ok(Some(media)) => {
                            this.refresh_queue();
                            this.load_media(media, 0.0);
                        }
                        Ok(None) => this.refresh_queue(),
                        Err(error) => this.show_error(&error.to_string()),
                    }
                }
            },
        );
    }

    fn navigate_queue(self: &Rc<Self>, forward: bool) {
        let Some(client) = self.client.borrow().clone() else {
            return;
        };
        let weak = Rc::downgrade(self);
        self.spawn(
            async move {
                let selected = client.queue_navigate(forward).await?;
                match selected.media_id {
                    Some(id) => Ok(Some(client.media(id).await?)),
                    None => Ok(None),
                }
            },
            move |result: Result<Option<Media>, ApiError>| {
                if let Some(this) = weak.upgrade() {
                    match result {
                        Ok(Some(media)) => this.load_media(media, 0.0),
                        Ok(None) => {}
                        Err(error) => this.show_error(&error.to_string()),
                    }
                }
            },
        );
    }

    fn shutdown(&self) {
        if let Some(timer) = self.heartbeat_timer.borrow_mut().take() {
            timer.remove();
        }
        if let Some(timer) = self.playback_timer.borrow_mut().take() {
            timer.remove();
        }
        if let (Some(client), Some(session)) = (
            self.client.borrow().clone(),
            self.session.borrow_mut().take(),
        ) {
            let snapshot = self.coordinator.borrow().snapshot().clone();
            let position = self
                .engine
                .as_ref()
                .and_then(PlaybackEngine::position)
                .unwrap_or(snapshot.position);
            let _ = self.runtime.block_on(async {
                let cleanup = async {
                    if let Some(media) = snapshot.media {
                        let _ = client
                            .save_resume(media.id, position, snapshot.duration)
                            .await;
                    }
                    client.release(&session).await
                };
                tokio::time::timeout(Duration::from_secs(2), cleanup).await
            });
        }
        if let Some(engine) = &self.engine {
            let _ = engine.stop();
        }
    }

    fn show_error(&self, message: &str) {
        self.status.set_label(message);
        self.status.set_visible(true);
    }

    fn spawn<T, F, C>(&self, future: F, callback: C)
    where
        T: Send + 'static,
        F: std::future::Future<Output = T> + Send + 'static,
        C: FnOnce(T) + 'static,
    {
        let handle = self.runtime.spawn(future);
        glib::MainContext::default().spawn_local(async move {
            if let Ok(value) = handle.await {
                callback(value);
            }
        });
    }
}

fn quality_at(index: u32) -> Quality {
    match index {
        0 => Quality::Low,
        1 => Quality::Med,
        3 => Quality::Ori,
        _ => Quality::High,
    }
}
