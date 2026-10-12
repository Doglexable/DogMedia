use dioxus_native::prelude::*;

use super::super::*;
use super::{
    AppMenubar, FullPlayer, Library, PlayerBar, QualityOverlay, QueuePanel, SettingsDialog,
    Sidebar, VideoMiniPlayer,
};

#[component]
pub(crate) fn Shell(
    app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
    video_source_id: u64,
) -> Element {
    let snapshot = app.read();
    // The previous modal remains exported by views/mod.rs for existing callers.
    let _connection_dialog = super::ConnectionErrorDialog;
    #[cfg(target_os = "linux")]
    let system_fallback = ColorScheme::Light;
    #[cfg(not(target_os = "linux"))]
    let system_fallback = ColorScheme::System;
    let selected_scheme = if snapshot.settings.color_scheme == ColorScheme::System {
        snapshot.system_color_scheme.unwrap_or(system_fallback)
    } else {
        snapshot.settings.color_scheme
    };
    let shell_class = match selected_scheme {
        ColorScheme::Light => "vault-shell light",
        ColorScheme::Dark => "vault-shell dark",
        ColorScheme::System => "vault-shell system",
    };
    let has_media = snapshot.coordinator.snapshot().media.is_some();
    let playback = snapshot.coordinator.snapshot();

    let mut queue_mounted = use_signal(|| snapshot.queue_open);
    use_effect(move || {
        let is_open = app.read().queue_open;
        if is_open {
            *queue_mounted.write() = true;
        } else {
            spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(260)).await;
                if !app.read().queue_open {
                    *queue_mounted.write() = false;
                }
            });
        }
    });

    let on_shell_keydown = move |event: KeyboardEvent| {
        let player_expanded = app.read().player_expanded;
        match event.key() {
            Key::Escape => {
                let mut app_w = app.write();
                if app_w.quality_popover_open {
                    app_w.quality_popover_open = false;
                } else if app_w.settings_open
                    && app_w.settings.configured
                    && !app_w.settings_connecting
                {
                    app_w.settings_open = false;
                    app_w.settings_error = None;
                } else if app_w.queue_open {
                    app_w.queue_open = false;
                } else if app_w.player_expanded {
                    app_w.player_expanded = false;
                }
            }
            Key::Character(ref ch)
                if (ch == " " || ch == "k" || ch == "K") && has_media && !player_expanded =>
            {
                toggle_playback(app, engine);
            }
            Key::ArrowLeft if has_media && !player_expanded => {
                skip_seconds(app, engine, -10.0);
            }
            Key::ArrowRight if has_media && !player_expanded => {
                skip_seconds(app, engine, 10.0);
            }
            Key::Character(ref ch) if (ch == "j" || ch == "J") && has_media && !player_expanded => {
                skip_seconds(app, engine, -10.0);
            }
            Key::Character(ref ch) if (ch == "l" || ch == "L") && has_media && !player_expanded => {
                skip_seconds(app, engine, 10.0);
            }
            Key::ArrowUp if has_media && !player_expanded => {
                let vol = app.read().settings.volume.get();
                set_volume(app, engine, (vol + 0.1).min(1.0));
            }
            Key::ArrowDown if has_media && !player_expanded => {
                let vol = app.read().settings.volume.get();
                set_volume(app, engine, (vol - 0.1).max(0.0));
            }
            Key::Character(ref ch) if (ch == "m" || ch == "M") && has_media && !player_expanded => {
                toggle_mute(app, engine);
            }
            Key::Character(ref ch) if (ch == "n" || ch == "N") && has_media && !player_expanded => {
                navigate_queue(app, engine, true, false);
            }
            Key::Character(ref ch) if (ch == "p" || ch == "P") && has_media && !player_expanded => {
                navigate_queue(app, engine, false, false);
            }
            Key::Character(ref ch) if (ch == "q" || ch == "Q") && has_media && !player_expanded => {
                let open = app.read().queue_open;
                app.write().queue_open = !open;
            }
            Key::Character(ref ch) if (ch == "f" || ch == "F") && has_media && !player_expanded => {
                app.write().player_expanded = true;
            }
            Key::Character(ref ch) if (ch == "," || ch == "<") => {
                let current_url = app.read().settings.server_url.to_string();
                app.write().settings_url = current_url;
                app.write().settings_error = None;
                app.write().queue_open = false;
                app.write().settings_open = true;
            }
            _ => {}
        }
    };

    rsx! {
        style { {CSS} }
        div {
            class: "{shell_class}",
            tabindex: "-1",
            autofocus: true,
            onkeydown: on_shell_keydown,
            div { class: "vault-topbar",
                AppMenubar { app, engine }
            }
            if !snapshot.player_expanded
                && !snapshot.queue_open
                && !snapshot.quality_popover_open
                && !snapshot.settings_open
            {
                // Blitz currently keeps focus on a node after that node is
                // removed. Remounting this sink restores global shortcuts
                // after a player or dialog closes.
                div {
                    class: "keyboard-focus-sink",
                    tabindex: "-1",
                    autofocus: true,
                    "aria-hidden": "true",
                }
            }
            Sidebar { app, engine }
            div { class: if has_media { "vault-workspace with-player" } else { "vault-workspace" },
                header { class: "vault-header",
                    div { class: "header-search",
                        Icon { name: IconName::Search, class: "search-icon".to_owned() }
                        Input {
                            input_type: "search".to_owned(),
                            placeholder: "Search your library…".to_owned(),
                            value: snapshot.search.clone(),
                            oninput: move |event: FormEvent| app.write().search = event.value(),
                            onkeydown: move |event: KeyboardEvent| {
                                if event.key() == Key::Enter {
                                    begin_browse(app);
                                } else if event.key() == Key::Escape {
                                    let has_search = !app.read().search.is_empty();
                                    if has_search {
                                        app.write().search.clear();
                                        begin_browse(app);
                                    }
                                }
                            }
                        }
                        if !snapshot.search.is_empty() {
                            IconButton {
                                label: "Clear search".to_owned(),
                                icon: IconName::Close,
                                class: "search-clear".to_owned(),
                                onclick: move |_| { app.write().search.clear(); begin_browse(app); }
                            }
                        }
                    }
                    div { class: "header-actions",
                        span { class: "header-context", if snapshot.local_mode { "Offline files" } else if snapshot.favorites_only { "Favorites" } else { "Private library" } }
                        IconButton { label: "Refresh library".to_owned(), icon: IconName::Refresh, onclick: move |_| refresh(app) }
                    }
                }
                if let Some(status) = snapshot.status.as_ref() {
                    div { class: "main-notice",
                        Notice { message: status.clone(), onclose: move |_| app.write().status = None }
                    }
                }
                if !snapshot.local_mode {
                    if let AccessView::Unreachable(error) = &snapshot.library.access {
                        div { class: "main-notice",
                            p { "Server unreachable: {error}" }
                            div { class: "empty-actions",
                                Button { label: "Open local folder".to_owned(), class: "primary".to_owned(), onclick: move |_| pick_local_folder(app, engine) }
                                Button { label: "Retry connection".to_owned(), class: "secondary".to_owned(), onclick: move |_| refresh(app) }
                            }
                        }
                    }
                }
                Library { app, engine }
            }
            if has_media && !snapshot.player_expanded {
                if let Some(media) = playback.media.as_ref()
                    && media.is_video()
                {
                    VideoMiniPlayer { app, engine, video_source_id }
                } else {
                    PlayerBar { app, engine }
                }
            }
            if snapshot.player_expanded && has_media {
                FullPlayer { app, engine, video_source_id }
            }
            if snapshot.quality_popover_open {
                if let Some(media) = playback.media.as_ref() {
                    QualityOverlay {
                        app,
                        engine,
                        quality: playback.quality,
                        is_video: media.is_video(),
                        expanded: snapshot.player_expanded,
                        has_lyrics: !snapshot.lyrics.trim().is_empty(),
                    }
                }
            }
            if *queue_mounted.read() {
                if snapshot.local_mode {
                    aside { class: "queue-panel", "aria-label": "Local playback queue",
                        header { class: "panel-header",
                            div { p { class: "eyebrow", "Offline" } h2 { "Local queue" } span { "{snapshot.local_tracks.len()} items" } }
                            IconButton { label: "Close queue".to_owned(), icon: IconName::Close, onclick: move |_| app.write().queue_open = false }
                        }
                        div { class: "track-list",
                            for (index, track) in snapshot.local_tracks.iter().enumerate() {
                                div { key: "{track.path.display()}", class: if snapshot.local_index == Some(index) { "track-row active" } else { "track-row" },
                                    button { class: "track-main", onclick: move |_| play_local_at(app, engine, index),
                                        span { class: "track-leading", "{index + 1}" }
                                        span { class: "track-title", "{track.title}" }
                                    }
                                }
                            }
                        }
                    }
                } else {
                    QueuePanel { app, engine }
                }
            }
            if snapshot.settings_open {
                SettingsDialog { app }
            }
        }
    }
}
