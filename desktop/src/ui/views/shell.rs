use dioxus_native::prelude::*;

use super::super::*;
use super::{
    FullPlayer, Library, PlayerBar, QualityOverlay, QueuePanel, SettingsDialog, Sidebar,
    VideoMiniPlayer,
};

#[component]
pub(crate) fn Shell(
    app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
    video_source_id: u64,
) -> Element {
    let snapshot = app.read().clone();
    let shell_class = match snapshot.settings.color_scheme {
        ColorScheme::Light => "vault-shell light",
        ColorScheme::Dark => "vault-shell dark",
        ColorScheme::System => "vault-shell system",
    };
    let has_media = snapshot.coordinator.snapshot().media.is_some();
    let playback = snapshot.coordinator.snapshot();

    let on_shell_keydown = move |event: KeyboardEvent| {
        tracing::info!(
            target: "dogmedia_desktop::keyboard",
            layer = "shell",
            key = ?event.key(),
            "DOM keyboard event"
        );
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
                if (ch == " " || ch == "k" || ch == "K")
                    && has_media
                    && !app.read().player_expanded =>
            {
                toggle_playback(app, engine);
            }
            Key::ArrowLeft if has_media && !app.read().player_expanded => {
                skip_seconds(app, engine, -10.0);
            }
            Key::ArrowRight if has_media && !app.read().player_expanded => {
                skip_seconds(app, engine, 10.0);
            }
            Key::Character(ref ch)
                if (ch == "j" || ch == "J") && has_media && !app.read().player_expanded =>
            {
                skip_seconds(app, engine, -10.0);
            }
            Key::Character(ref ch)
                if (ch == "l" || ch == "L") && has_media && !app.read().player_expanded =>
            {
                skip_seconds(app, engine, 10.0);
            }
            Key::ArrowUp if has_media && !app.read().player_expanded => {
                let vol = app.read().settings.volume.get();
                set_volume(app, engine, (vol + 0.1).min(1.0));
            }
            Key::ArrowDown if has_media && !app.read().player_expanded => {
                let vol = app.read().settings.volume.get();
                set_volume(app, engine, (vol - 0.1).max(0.0));
            }
            Key::Character(ref ch)
                if (ch == "m" || ch == "M") && has_media && !app.read().player_expanded =>
            {
                toggle_mute(app, engine);
            }
            Key::Character(ref ch)
                if (ch == "n" || ch == "N") && has_media && !app.read().player_expanded =>
            {
                navigate_queue(app, engine, true, false);
            }
            Key::Character(ref ch)
                if (ch == "p" || ch == "P") && has_media && !app.read().player_expanded =>
            {
                navigate_queue(app, engine, false, false);
            }
            Key::Character(ref ch)
                if (ch == "q" || ch == "Q") && has_media && !app.read().player_expanded =>
            {
                let open = app.read().queue_open;
                app.write().queue_open = !open;
            }
            Key::Character(ref ch)
                if (ch == "f" || ch == "F") && has_media && !app.read().player_expanded =>
            {
                app.write().player_expanded = true;
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
            Sidebar { app }
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
                                } else if event.key() == Key::Escape && !app.read().search.is_empty() {
                                    app.write().search.clear();
                                    begin_browse(app);
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
                        span { class: "header-context", if snapshot.favorites_only { "Favorites" } else { "Private library" } }
                        IconButton { label: "Refresh library".to_owned(), icon: IconName::Refresh, onclick: move |_| refresh(app) }
                    }
                }
                if let Some(status) = snapshot.status.as_ref() {
                    div { class: "main-notice",
                        Notice { message: status.clone(), onclose: move |_| app.write().status = None }
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
            if snapshot.queue_open {
                QueuePanel { app, engine }
            }
            if snapshot.settings_open {
                SettingsDialog { app }
            }
        }
    }
}
