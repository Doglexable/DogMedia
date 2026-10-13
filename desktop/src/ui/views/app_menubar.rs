use dioxus_native::prelude::*;

use super::super::kit::{Icon, IconName};
use super::super::menubar::{
    Menubar, MenubarContent, MenubarGroup, MenubarItem, MenubarLabel, MenubarMenu,
    MenubarRadioGroup, MenubarRadioItem, MenubarSeparator, MenubarShortcut, MenubarTrigger,
};
use super::super::*;
use crate::store::ColorScheme;

#[component]
pub(crate) fn AppMenubar(
    app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
) -> Element {
    let snapshot = app.read();
    let version = env!("CARGO_PKG_VERSION");
    let has_media = snapshot.coordinator.snapshot().media.is_some();
    let playback = snapshot.coordinator.snapshot();
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
                            onclick: move |_| refresh(app),
                            Icon { name: IconName::Refresh, class: "menubar-item-icon".to_owned() }
                            span { "Refresh Library" }
                            MenubarShortcut { "⌘R" }
                        }
                        MenubarItem {
                            onclick: move |_| pick_local_folder(app, engine),
                            Icon { name: IconName::Folder, class: "menubar-item-icon".to_owned() }
                            span { "Open Local Folder…" }
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
                            onclick: move |_| {
                                begin_browse(app);
                            },
                            Icon { name: IconName::Search, class: "menubar-item-icon".to_owned() }
                            span { "Search Library" }
                            MenubarShortcut { "⌘F" }
                        }
                        MenubarItem {
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
                            disabled: !has_media,
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
                            onclick: move |_| {
                                app.write().favorites_only = false;
                                app.write().category_id = None;
                                begin_browse(app);
                            },
                            Icon { name: IconName::Grid, class: "menubar-item-icon".to_owned() }
                            span { "All Media" }
                        }
                        MenubarItem {
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
                            onclick: move |_| {
                                let open = app.read().queue_open;
                                app.write().queue_open = !open;
                            },
                            Icon { name: IconName::List, class: "menubar-item-icon".to_owned() }
                            span { if is_queue_open { "Hide Queue" } else { "Show Queue" } }
                            MenubarShortcut { "Q" }
                        }
                        MenubarItem {
                            disabled: !has_media,
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
                            disabled: !has_media,
                            onclick: move |_| toggle_playback(app, engine),
                            Icon {
                                name: if is_playing { IconName::Pause } else { IconName::Play },
                                class: "menubar-item-icon".to_owned(),
                            }
                            span { if is_playing { "Pause" } else { "Play" } }
                            MenubarShortcut { "Space" }
                        }
                        MenubarItem {
                            disabled: !has_media,
                            onclick: move |_| navigate_queue(app, engine, false, false),
                            Icon { name: IconName::Previous, class: "menubar-item-icon".to_owned() }
                            span { "Previous" }
                            MenubarShortcut { "P" }
                        }
                        MenubarItem {
                            disabled: !has_media,
                            onclick: move |_| navigate_queue(app, engine, true, false),
                            Icon { name: IconName::Next, class: "menubar-item-icon".to_owned() }
                            span { "Next" }
                            MenubarShortcut { "N" }
                        }
                        MenubarItem {
                            disabled: !has_media,
                            onclick: move |_| stop_playback(app, engine),
                            Icon { name: IconName::Stop, class: "menubar-item-icon".to_owned() }
                            span { "Stop" }
                        }
                    }
                    MenubarSeparator {}
                    MenubarGroup {
                        MenubarItem {
                            disabled: !has_media,
                            onclick: move |_| toggle_mute(app, engine),
                            Icon {
                                name: if is_muted { IconName::VolumeMute } else { IconName::Volume },
                                class: "menubar-item-icon".to_owned(),
                            }
                            span { if is_muted { "Unmute" } else { "Mute" } }
                            MenubarShortcut { "M" }
                        }
                        MenubarItem {
                            disabled: !has_media,
                            onclick: move |_| {
                                let vol = app.read().settings.volume.get();
                                set_volume(app, engine, (vol + 0.1).min(1.0));
                            },
                            span { "Volume Up" }
                            MenubarShortcut { "↑" }
                        }
                        MenubarItem {
                            disabled: !has_media,
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
