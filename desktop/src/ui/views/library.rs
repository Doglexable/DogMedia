use dioxus_native::prelude::*;

use super::super::*;
use super::Featured;

const LIST_PAGE_SIZE: usize = 100;

fn list_page_window(total: usize, requested_page: usize) -> (usize, usize) {
    if total == 0 {
        return (0, 0);
    }
    let last_page = (total - 1) / LIST_PAGE_SIZE;
    let start = requested_page.min(last_page) * LIST_PAGE_SIZE;
    (start, (start + LIST_PAGE_SIZE).min(total))
}

#[component]
pub(crate) fn Library(app: Signal<NativeApp>, engine: Signal<Option<PlaybackEngine>>) -> Element {
    let mut context_menu = use_signal(|| None::<MediaId>);
    let mut list_page = use_signal(|| (false, 0u64, 0usize));
    let snapshot = app.read();
    let playback = snapshot.coordinator.snapshot();
    let page_key = (
        snapshot.local_mode,
        if snapshot.local_mode {
            snapshot.local_scan_generation
        } else {
            snapshot.library.generation()
        },
    );
    let requested_page = {
        let state = list_page.read();
        if (state.0, state.1) == page_key {
            state.2
        } else {
            0
        }
    };
    if snapshot.local_mode {
        let (start, end) = list_page_window(snapshot.local_tracks.len(), requested_page);
        let page = start / LIST_PAGE_SIZE;
        let folder = snapshot
            .settings
            .local_folder
            .as_ref()
            .map(|path| path.display().to_string())
            .unwrap_or_default();
        return rsx! {
            main { class: "library-main",
                section { class: "browse-section", "aria-labelledby": "library-heading",
                    div { class: "library-heading",
                        div {
                            p { class: "eyebrow", "Offline library" }
                            h2 { id: "library-heading", "Local files" }
                            small { "{folder}" }
                        }
                        span { "{snapshot.local_tracks.len()} items" }
                    }
                    div { class: "empty-actions",
                        Button { label: "Open local folder".to_owned(), class: "secondary".to_owned(), onclick: move |_| pick_local_folder(app, engine) }
                        Button { label: "Retry connection".to_owned(), class: "secondary".to_owned(), onclick: move |_| refresh(app) }
                    }
                    div { class: "track-list",
                        for (index, track) in snapshot.local_tracks.iter().enumerate().skip(start).take(end - start) {
                            div { key: "{track.path.display()}", class: if snapshot.local_index == Some(index) { "track-row active" } else { "track-row" },
                                div { class: "track-main", role: "button", tabindex: "0",
                                    onclick: move |_| play_local_at(app, engine, index),
                                    onkeydown: move |event: KeyboardEvent| {
                                        if event.key() == Key::Enter { play_local_at(app, engine, index); }
                                    },
                                    span { class: "track-leading", "{index + 1}" }
                                    span { class: "track-title", strong { "{track.title}" } }
                                    span { class: "track-folder", "{track.path.parent().map(|path| path.display().to_string()).unwrap_or_default()}" }
                                    span { class: "duration", if track.kind == LocalKind::Video { "Video" } else { "Audio" } }
                                }
                            }
                        }
                    }
                    if snapshot.local_tracks.len() > LIST_PAGE_SIZE {
                        div { class: "empty-actions",
                            if start > 0 {
                                Button { label: "Previous page".to_owned(), class: "secondary".to_owned(), onclick: move |_| {
                                    list_page.set((page_key.0, page_key.1, page - 1));
                                } }
                            }
                            span { "{start + 1}–{end} of {snapshot.local_tracks.len()}" }
                            if end < snapshot.local_tracks.len() {
                                Button { label: "Next page".to_owned(), class: "secondary".to_owned(), onclick: move |_| {
                                    list_page.set((page_key.0, page_key.1, page + 1));
                                } }
                            }
                        }
                    }
                }
            }
        };
    }
    let item_count = snapshot.library.items.len();
    let (start, end) = list_page_window(item_count, requested_page);
    let page = start / LIST_PAGE_SIZE;
    let can_load_more = snapshot.library.next_cursor.is_some() && !snapshot.library.loading;

    let title = if snapshot.favorites_only {
        "Favorites".to_owned()
    } else if let Some(category_id) = snapshot.category_id {
        snapshot
            .categories
            .iter()
            .find(|category| category.id == category_id)
            .and_then(|category| {
                category
                    .path
                    .clone()
                    .or_else(|| Some(category.name.clone()))
            })
            .unwrap_or_else(|| "Library".to_owned())
    } else {
        "All media".to_owned()
    };
    let featured = featured_media(&snapshot);
    let open_menu = *context_menu.read();

    rsx! {
        main {
            class: "library-main",
            onclick: move |_| context_menu.set(None),
            onkeydown: move |event: KeyboardEvent| {
                if event.key() == Key::Escape {
                    context_menu.set(None);
                }
            },
            div { class: "type-pills", role: "group", "aria-label": "Media type",
                for (value, label) in [(MediaFilter::All, "All"), (MediaFilter::Audio, "Music"), (MediaFilter::Video, "Video"), (MediaFilter::Photo, "Photos")] {
                    Chip {
                        label: label.to_owned(),
                        selected: snapshot.media_filter == value,
                        onclick: move |_| {
                            app.write().media_filter = value;
                            begin_browse(app);
                        }
                    }
                }
            }
            if snapshot.search.trim().is_empty() {
                if let Some(media) = featured {
                    Featured { app, engine, media }
                }
            }
            section { class: "browse-section", "aria-labelledby": "library-heading",
                div { class: "library-heading",
                    div {
                        p { class: "eyebrow", "Library index" }
                        h2 { id: "library-heading", "{title}" }
                    }
                    span { "{item_count} items" }
                }
                div { class: "track-list",
                    div { class: "track-header", "aria-hidden": "true",
                        div { class: "track-header-main",
                            span { "#" }
                            span { "Title" }
                            span { "Folder" }
                            span { class: "track-added-heading", "Added" }
                            span { class: "duration-heading", title: "Duration",
                                Icon { name: IconName::Clock }
                            }
                        }
                        span {}
                    }
                    if snapshot.library.loading && snapshot.library.items.is_empty() {
                        MediaListSkeleton { rows: 7 }
                    } else if snapshot.library.items.is_empty() {
                        match &snapshot.library.access {
                            AccessView::FirstRun => {
                                rsx! {
                                    div { class: "empty-state",
                                        div { class: "empty-mark", Icon { name: IconName::Library } }
                                        h3 { "Configure Server Connection" }
                                        p { "Please enter your Dogmedia server URL in Settings to connect to your library." }
                                        div { class: "empty-actions",
                                            Button { label: "Open Settings".to_owned(), class: "primary".to_owned(), onclick: move |_| {
                                                let current_url = app.read().settings.server_url.to_string();
                                                app.write().settings_url = current_url;
                                                app.write().settings_error = None;
                                                app.write().settings_open = true;
                                            } }
                                        }
                                    }
                                }
                            }
                            AccessView::Denied => {
                                rsx! {
                                    div { class: "empty-state",
                                        div { class: "empty-mark", Icon { name: IconName::Close } }
                                        h3 { "Server Access Denied" }
                                        p { "This computer's IP address is not whitelisted by the server (requires tier 100 or higher). Add this IP in the server administration or PostgreSQL 'ip_whitelist' table." }
                                        div { class: "empty-actions",
                                            Button { label: "Open Settings".to_owned(), class: "secondary".to_owned(), onclick: move |_| {
                                                let current_url = app.read().settings.server_url.to_string();
                                                app.write().settings_url = current_url;
                                                app.write().settings_error = None;
                                                app.write().settings_open = true;
                                            } }
                                            Button { label: "Retry Connection".to_owned(), class: "primary".to_owned(), onclick: move |_| refresh(app) }
                                        }
                                    }
                                }
                            }
                            AccessView::Unreachable(_) => rsx! {
                                div { class: "empty-state",
                                    div { class: "empty-mark", Icon { name: IconName::Library } }
                                    h3 { "Server unreachable" }
                                    p { "Open a folder on this computer to play audio and video offline." }
                                    div { class: "empty-actions",
                                        Button { label: "Open local folder".to_owned(), class: "primary".to_owned(), onclick: move |_| pick_local_folder(app, engine) }
                                        Button { label: "Retry connection".to_owned(), class: "secondary".to_owned(), onclick: move |_| refresh(app) }
                                    }
                                }
                            },
                            _ => {
                                rsx! {
                                    div { class: "empty-state",
                                        div { class: "empty-mark", Icon { name: IconName::Library } }
                                        h3 { if snapshot.search.trim().is_empty() { "Nothing here yet" } else { "No matching media" } }
                                        p { if snapshot.search.trim().is_empty() { "Choose another category or media type." } else { "Clear the search or try a different title." } }
                                        if !snapshot.search.trim().is_empty() {
                                            div { class: "empty-actions",
                                                Button { label: "Clear search".to_owned(), class: "secondary".to_owned(), onclick: move |_| {
                                                    app.write().search.clear();
                                                    begin_browse(app);
                                                } }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    for (index, media) in snapshot.library.items.iter().enumerate().skip(start).take(end - start) {
                        div {
                            key: "{media.id}",
                            class: "track-row",
                            div {
                            class: match (
                                playback
                                    .media
                                    .as_ref()
                                    .is_some_and(|playing| playing.id == media.id),
                                open_menu == Some(media.id),
                            ) {
                                (true, true) => "media-track active menu-open",
                                (true, false) => "media-track active",
                                (false, true) => "media-track menu-open",
                                (false, false) => "media-track",
                            },
                            div {
                                class: "track-main",
                                role: "button",
                                tabindex: "0",
                                title: "Play {media.title()}",
                                onclick: { let media = media.clone(); move |_| play_media(app, engine, media.clone(), true) },
                                onkeydown: {
                                    let media = media.clone();
                                    move |event: KeyboardEvent| {
                                        match event.key() {
                                            Key::Enter => {
                                                play_media(app, engine, media.clone(), true);
                                            }
                                            Key::Character(ref ch) if ch == " " => {
                                                play_media(app, engine, media.clone(), true);
                                            }
                                            _ => {}
                                        }
                                    }
                                },
                                span { class: "track-leading", "aria-hidden": "true",
                                    span { class: "track-index", "{index + 1}" }
                                    span { class: "track-play", Icon { name: IconName::Play } }
                                }
                                span { class: "track-title",
                                    strong { "{media.title()}" }
                                    small { "{media.subtitle()}" }
                                }
                                span {
                                    class: "track-folder",
                                    title: "{media.category_path.as_deref().or(media.category_name.as_deref()).unwrap_or(\"Library\")}",
                                    "{media_folder(media)}"
                                }
                                span { class: "track-added", "{format_added_date(media.created_at.as_deref())}" }
                                span { class: "duration", "{format_duration(media.duration)}" }
                            }
                            div { class: "track-actions",
                                if media.is_audio() {
                                    IconButton {
                                        label: if media.liked { "Remove from favorites".to_owned() } else { "Add to favorites".to_owned() },
                                        icon: IconName::Heart,
                                        class: if media.liked { "favorite active".to_owned() } else { "favorite".to_owned() },
                                        onclick: { let media = media.clone(); let liked = !media.liked; move |_| set_media_favorite(app, media.clone(), liked) }
                                    }
                                }
                                button {
                                    class: "icon-button more-menu",
                                    r#type: "button",
                                    title: "More options",
                                    "aria-label": "More options for {media.title()}",
                                    "aria-haspopup": "menu",
                                    "aria-expanded": open_menu == Some(media.id),
                                    onclick: {
                                        let id = media.id;
                                        move |event: MouseEvent| {
                                            event.stop_propagation();
                                            context_menu.set(if open_menu == Some(id) { None } else { Some(id) });
                                        }
                                    },
                                    Icon { name: IconName::More }
                                }
                            }
                            if open_menu == Some(media.id) {
                                div {
                                    class: "context-menu row-context-menu below",
                                    role: "menu",
                                    "aria-label": "Options for {media.title()}",
                                    onclick: move |event: MouseEvent| event.stop_propagation(),
                                        button {
                                            class: "context-menu-item",
                                            r#type: "button",
                                            role: "menuitem",
                                            onclick: { let id = media.id; move |_| {
                                                context_menu.set(None);
                                                add_media_to_queue(app, id, true);
                                            } },
                                            span { class: "context-menu-icon", Icon { name: IconName::Next } }
                                            span { "Play next" }
                                        }
                                        button {
                                            class: "context-menu-item",
                                            r#type: "button",
                                            role: "menuitem",
                                            onclick: { let id = media.id; move |_| {
                                                context_menu.set(None);
                                                add_media_to_queue(app, id, false);
                                            } },
                                            span { class: "context-menu-icon", Icon { name: IconName::ListPlus } }
                                            span { "Add to queue" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if item_count > LIST_PAGE_SIZE {
                        div { class: "empty-actions",
                            if start > 0 {
                                Button { label: "Previous page".to_owned(), class: "secondary".to_owned(), onclick: move |_| {
                                    list_page.set((page_key.0, page_key.1, page - 1));
                                } }
                            }
                            span { "{start + 1}–{end} of {item_count} loaded" }
                            if end < item_count {
                                Button { label: "Next page".to_owned(), class: "secondary".to_owned(), onclick: move |_| {
                                    list_page.set((page_key.0, page_key.1, page + 1));
                                } }
                            }
                        }
                    }
                    if snapshot.library.loading && !snapshot.library.items.is_empty() {
                        MediaListSkeleton { rows: 2 }
                    } else if can_load_more {
                        Button { label: "Load more".to_owned(), class: "wide secondary".to_owned(), onclick: move |_| load_more(app) }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod list_page_tests {
    use super::list_page_window;

    #[test]
    fn page_window_keeps_absolute_indexes_and_clamps_after_filtering() {
        assert_eq!(list_page_window(0, 0), (0, 0));
        assert_eq!(list_page_window(50, 0), (0, 50));
        assert_eq!(list_page_window(250, 1), (100, 200));
        assert_eq!(list_page_window(250, 2), (200, 250));
        assert_eq!(list_page_window(50, 9), (0, 50));
    }
}
