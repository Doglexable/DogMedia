use dioxus_native::prelude::*;

use super::super::*;
use super::{FullPlayer, Library, PlayerBar, QueuePanel, SettingsDialog, Sidebar};

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

    rsx! {
        style { {CSS} }
        div { class: "{shell_class}",
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
                            onkeydown: move |event: KeyboardEvent| if event.key() == Key::Enter { begin_browse(app); }
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
                PlayerBar { app, engine }
            }
            if snapshot.player_expanded && has_media {
                FullPlayer { app, engine, video_source_id }
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
