use dioxus_native::prelude::*;

use super::super::kit::{Icon, IconName};
use super::super::menubar::{
    Menubar, MenubarContent, MenubarGroup, MenubarItem, MenubarLabel, MenubarMenu,
    MenubarRadioGroup, MenubarRadioItem, MenubarSeparator, MenubarShortcut, MenubarTrigger,
};
use super::super::*;
use crate::store::ColorScheme;

#[derive(Debug, Clone, Copy)]
struct MenuAvailability {
    settings: bool,
    refresh: bool,
    local_folder: bool,
    search: bool,
    clear_search: bool,
    clear_queue: bool,
    all_media: bool,
    favorites: bool,
    queue: bool,
    full_player: bool,
    playback: bool,
    previous: bool,
    next: bool,
    stop: bool,
    volume_up: bool,
    volume_down: bool,
}

impl MenuAvailability {
    fn from_app(app: &NativeApp, engine_available: bool) -> Self {
        let playback = app.coordinator.snapshot();
        let has_media = playback.media.is_some();
        let can_browse = !app.local_mode
            && app.client.is_some()
            && matches!(&app.library.access, AccessView::Ready);
        let can_control_playback = has_media
            && engine_available
            && !playback.session_unavailable
            && matches!(
                playback.status,
                PlaybackStatus::Playing | PlaybackStatus::Paused
            );
        let repeat_queue = playback.repeat == RepeatMode::Queue;
        let (has_previous, has_next) = if app.local_mode {
            let len = app.local_tracks.len();
            let index = app.local_index;
            (
                index.is_some_and(|index| index > 0 || (repeat_queue && len > 1)),
                index.is_some_and(|index| index + 1 < len || (repeat_queue && len > 1)),
            )
        } else {
            app.queue.as_ref().map_or((false, false), |queue| {
                (
                    queue.has_previous || (repeat_queue && queue.total > 1),
                    queue.has_next || (repeat_queue && queue.total > 1),
                )
            })
        };
        let volume = app.settings.volume.get();
        let queue_available = if app.local_mode {
            !app.local_tracks.is_empty()
        } else {
            app.queue
                .as_ref()
                .is_some_and(|queue| queue.total > 0 || has_media)
        };

        Self {
            settings: !app.settings_open && !app.settings_connecting,
            refresh: app.client.is_some()
                && !app.settings_connecting
                && matches!(
                    &app.library.access,
                    AccessView::Ready | AccessView::Unreachable(_)
                ),
            local_folder: !app.settings_connecting
                && matches!(&app.library.access, AccessView::Unreachable(_)),
            search: can_browse && !app.search.trim().is_empty(),
            clear_search: !app.search.is_empty(),
            clear_queue: can_browse && app.queue.as_ref().is_some_and(|queue| queue.total > 0),
            all_media: can_browse && (app.favorites_only || app.category_id.is_some()),
            favorites: can_browse && !app.favorites_only,
            queue: app.queue_open || queue_available,
            full_player: has_media,
            playback: can_control_playback,
            previous: can_control_playback && (playback.position > 3.0 || has_previous),
            next: can_control_playback && has_next,
            stop: has_media,
            volume_up: can_control_playback && volume < 1.0,
            volume_down: can_control_playback && volume > 0.0,
        }
    }
}

#[component]
pub(crate) fn AppMenubar(
    app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
) -> Element {
    let snapshot = app.read();
    let version = env!("CARGO_PKG_VERSION");
    let playback = snapshot.coordinator.snapshot();
    let available = MenuAvailability::from_app(&snapshot, engine.read().is_some());
    let is_playing = playback.status == PlaybackStatus::Playing;
    let is_muted = snapshot.settings.volume.get() <= 0.0;
    let is_queue_open = snapshot.queue_open;
    let is_player_expanded = snapshot.player_expanded;
    let current_scheme = snapshot.settings.color_scheme;
    let (access_label, _) = match &snapshot.library.access {
        AccessView::Ready => ("Connected", "online"),
        AccessView::Checking => ("Connecting", "pending"),
        AccessView::Denied => ("Access denied", "offline"),
        AccessView::Unreachable(_) => ("Offline", "offline"),
        AccessView::FirstRun => ("Setup required", "pending"),
    };

    rsx! {
        Menubar { class: "app-menubar",
            // ── Dogmedia / App ──
            MenubarMenu {
                MenubarTrigger { "Dogmedia" }
                MenubarContent {
                    MenubarGroup {
                        MenubarItem {
                            disabled: !available.settings,
                            onclick: move |_| {
                                let current_url = app.read().settings.server_url.to_string();
                                app.write().settings_url = current_url;
                                app.write().settings_error = None;
                                app.write().queue_open = false;
                                app.write().settings_open = true;
                            },
                            Icon { name: IconName::Settings, class: "menubar-item-icon".to_owned() }
                            span { "Settings…" }
                            MenubarShortcut { "⌘," }
                        }
                    }
                    MenubarSeparator {}
                    MenubarGroup {
                        MenubarItem {
                            disabled: !available.refresh,
                            onclick: move |_| refresh(app),
                            Icon { name: IconName::Refresh, class: "menubar-item-icon".to_owned() }
                            span { if matches!(&snapshot.library.access, AccessView::Ready) { "Refresh Library" } else { "Retry Connection" } }
                            MenubarShortcut { "⌘R" }
                        }
                        MenubarItem {
                            disabled: !available.local_folder,
                            onclick: move |_| pick_local_folder(app, engine),
                            Icon { name: IconName::Folder, class: "menubar-item-icon".to_owned() }
                            span { if snapshot.local_mode { "Change Local Folder…" } else { "Open Local Folder…" } }
                            MenubarShortcut { "⌘O" }
                        }
                    }
                    MenubarSeparator {}
                    MenubarGroup {
                        MenubarItem {
                            onclick: move |_| {
                                spawn(async {
                                    std::process::exit(0);
                                });
                            },
                            span { "Quit Dogmedia" }
                            MenubarShortcut { "⌘Q" }
                        }
                    }
                }
            }

            // ── Edit ──
            MenubarMenu {
                MenubarTrigger { "Edit" }
                MenubarContent {
                    MenubarGroup {
                        MenubarItem {
                            disabled: !available.search,
                            onclick: move |_| {
                                begin_browse(app);
                            },
                            Icon { name: IconName::Search, class: "menubar-item-icon".to_owned() }
                            span { "Apply Search" }
                            MenubarShortcut { "Enter" }
                        }
                        MenubarItem {
                            disabled: !available.clear_search,
                            onclick: move |_| {
                                app.write().search.clear();
                                begin_browse(app);
                            },
                            Icon { name: IconName::Close, class: "menubar-item-icon".to_owned() }
                            span { "Clear Search" }
                            MenubarShortcut { "Esc" }
                        }
                    }
                    MenubarSeparator {}
                    MenubarGroup {
                        MenubarItem {
                            disabled: !available.clear_queue,
                            onclick: move |_| {
                                queue_clear(app);
                            },
                            Icon { name: IconName::ListPlus, class: "menubar-item-icon".to_owned() }
                            span { "Clear Playback Queue" }
                        }
                    }
                }
            }

            // ── View ──
            MenubarMenu {
                MenubarTrigger { "View" }
                MenubarContent {
                    MenubarGroup {
                        MenubarItem {
                            disabled: !available.all_media,
                            onclick: move |_| {
                                app.write().favorites_only = false;
                                app.write().category_id = None;
                                begin_browse(app);
                            },
                            Icon { name: IconName::Grid, class: "menubar-item-icon".to_owned() }
                            span { "All Media" }
                        }
                        MenubarItem {
                            disabled: !available.favorites,
                            onclick: move |_| {
                                app.write().favorites_only = true;
                                app.write().category_id = None;
                                begin_browse(app);
                            },
                            Icon { name: IconName::Heart, class: "menubar-item-icon".to_owned() }
                            span { "Favorites" }
                        }
                    }
                    MenubarSeparator {}
                    MenubarGroup {
                        MenubarItem {
                            disabled: !available.queue,
                            onclick: move |_| {
                                let open = app.read().queue_open;
                                app.write().queue_open = !open;
                            },
                            Icon { name: IconName::List, class: "menubar-item-icon".to_owned() }
                            span { if is_queue_open { "Hide Queue" } else { "Show Queue" } }
                            MenubarShortcut { "Q" }
                        }
                        MenubarItem {
                            disabled: !available.full_player,
                            onclick: move |_| {
                                let expanded = app.read().player_expanded;
                                app.write().player_expanded = !expanded;
                            },
                            Icon { name: IconName::Expand, class: "menubar-item-icon".to_owned() }
                            span { if is_player_expanded { "Exit Full Player" } else { "Full Player" } }
                            MenubarShortcut { "F" }
                        }
                    }
                    MenubarSeparator {}
                    MenubarLabel { "Appearance" }
                    MenubarGroup {
                        MenubarRadioGroup {
                            value: current_scheme,
                            onchange: move |scheme: ColorScheme| {
                                set_color_scheme(app, scheme);
                            },
                            MenubarRadioItem { value: ColorScheme::System, "System" }
                            MenubarRadioItem { value: ColorScheme::Dark, "Dark" }
                            MenubarRadioItem { value: ColorScheme::Light, "Light" }
                        }
                    }
                }
            }

            // ── Playback ──
            MenubarMenu {
                MenubarTrigger { "Playback" }
                MenubarContent {
                    MenubarGroup {
                        MenubarItem {
                            disabled: !available.playback,
                            onclick: move |_| toggle_playback(app, engine),
                            Icon {
                                name: if is_playing { IconName::Pause } else { IconName::Play },
                                class: "menubar-item-icon".to_owned(),
                            }
                            span { if is_playing { "Pause" } else { "Play" } }
                            MenubarShortcut { "Space" }
                        }
                        MenubarItem {
                            disabled: !available.previous,
                            onclick: move |_| navigate_queue(app, engine, false, false),
                            Icon { name: IconName::Previous, class: "menubar-item-icon".to_owned() }
                            span { "Previous" }
                            MenubarShortcut { "P" }
                        }
                        MenubarItem {
                            disabled: !available.next,
                            onclick: move |_| navigate_queue(app, engine, true, false),
                            Icon { name: IconName::Next, class: "menubar-item-icon".to_owned() }
                            span { "Next" }
                            MenubarShortcut { "N" }
                        }
                        MenubarItem {
                            disabled: !available.stop,
                            onclick: move |_| stop_playback(app, engine),
                            Icon { name: IconName::Stop, class: "menubar-item-icon".to_owned() }
                            span { "Stop" }
                        }
                    }
                    MenubarSeparator {}
                    MenubarGroup {
                        MenubarItem {
                            disabled: !available.playback,
                            onclick: move |_| toggle_mute(app, engine),
                            Icon {
                                name: if is_muted { IconName::VolumeMute } else { IconName::Volume },
                                class: "menubar-item-icon".to_owned(),
                            }
                            span { if is_muted { "Unmute" } else { "Mute" } }
                            MenubarShortcut { "M" }
                        }
                        MenubarItem {
                            disabled: !available.volume_up,
                            onclick: move |_| {
                                let vol = app.read().settings.volume.get();
                                set_volume(app, engine, (vol + 0.1).min(1.0));
                            },
                            span { "Volume Up" }
                            MenubarShortcut { "↑" }
                        }
                        MenubarItem {
                            disabled: !available.volume_down,
                            onclick: move |_| {
                                let vol = app.read().settings.volume.get();
                                set_volume(app, engine, (vol - 0.1).max(0.0));
                            },
                            span { "Volume Down" }
                            MenubarShortcut { "↓" }
                        }
                    }
                }
            }

            // ── Help ──
            MenubarMenu {
                MenubarTrigger { "Help" }
                MenubarContent {
                    MenubarGroup {
                        MenubarItem {
                            disabled: true,
                            span { "Status: {access_label}" }
                        }
                        MenubarItem {
                            disabled: true,
                            span { "Dogmedia Desktop v{version}" }
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connected_app() -> NativeApp {
        let mut app = NativeApp::boot();
        app.settings_open = false;
        app.settings_connecting = false;
        app.local_mode = false;
        app.library.access = AccessView::Ready;
        app.client = Some(
            ApiClient::new(
                &app.settings.server_url.to_string(),
                app.settings.viewer_id.clone(),
            )
            .expect("valid test server URL"),
        );
        app
    }

    #[test]
    fn menu_disables_actions_without_search_queue_or_playback() {
        let mut app = connected_app();
        let available = MenuAvailability::from_app(&app, false);
        assert!(!available.search);
        assert!(!available.clear_search);
        assert!(!available.clear_queue);
        assert!(!available.queue);
        assert!(!available.playback);
        assert!(!available.previous);
        assert!(!available.next);
        assert!(!available.stop);
        assert!(!available.all_media);
        assert!(available.favorites);

        app.search = "  ".to_owned();
        let available = MenuAvailability::from_app(&app, false);
        assert!(!available.search);
        assert!(available.clear_search);

        app.search = "Muse".to_owned();
        let available = MenuAvailability::from_app(&app, false);
        assert!(available.search);
        assert!(available.clear_search);
    }

    #[test]
    fn menu_uses_queue_boundaries_and_offline_mode() {
        let mut app = connected_app();
        app.queue = Some(QueueWindow {
            items: Vec::new(),
            offset: 0,
            total: 0,
            current_index: 0,
            current_media_id: None,
            has_previous: false,
            has_next: false,
            revision: 0,
        });
        let media: Media = serde_json::from_value(serde_json::json!({
            "id": 7,
            "mimeType": "audio/mpeg"
        }))
        .expect("valid media");
        app.coordinator.load(media);
        let sequence = app.coordinator.snapshot().sequence;
        app.coordinator.loaded(sequence, 0.0);

        let available = MenuAvailability::from_app(&app, true);
        assert!(available.playback);
        assert!(!available.clear_queue);
        assert!(!available.previous);
        assert!(!available.next);

        app.queue.as_mut().expect("queue").total = 2;
        app.queue.as_mut().expect("queue").has_next = true;
        let available = MenuAvailability::from_app(&app, true);
        assert!(available.clear_queue);
        assert!(available.next);

        app.local_mode = true;
        app.library.access = AccessView::Unreachable("offline".to_owned());
        app.queue = None;
        let available = MenuAvailability::from_app(&app, true);
        assert!(available.local_folder);
        assert!(!available.clear_queue);
        assert!(!available.favorites);
    }
}
