use dioxus_native::prelude::*;

use super::super::*;

#[component]
pub(crate) fn Sidebar(app: Signal<NativeApp>, engine: Signal<Option<PlaybackEngine>>) -> Element {
    let mut folder_menu = use_signal(|| None::<CategoryId>);
    let snapshot = app.read().clone();
    let version = env!("CARGO_PKG_VERSION");
    let open_menu = *folder_menu.read();
    let (access_label, access_class) = match &snapshot.library.access {
        AccessView::Ready => ("Connected", "online"),
        AccessView::Checking => ("Connecting", "pending"),
        AccessView::Denied => ("Access denied", "offline"),
        AccessView::Unreachable(_) => ("Offline", "offline"),
        AccessView::FirstRun => ("Setup required", "pending"),
    };

    rsx! {
        aside { class: "vault-sidebar", "aria-label": "Library navigation",
            div { class: "sidebar-brand",
                div { class: "brand-mark",
                    img {
                        class: "brand-mark-image",
                        src: "{brand_mark_data_url()}",
                        alt: "Dogmedia",
                        draggable: "false",
                    }
                }
                div { class: "brand-copy",
                    strong { "Dogmedia" }
                    small { title: "Your media. Your space. Your story. Your rhythm.", "Your media. Your space. Your story. Your rhythm." }
                }
            }
            nav { class: "sidebar-primary",
                button {
                    class: if !snapshot.favorites_only && snapshot.category_id.is_none() { "sidebar-link active" } else { "sidebar-link" },
                    r#type: "button",
                    onclick: move |_| {
                        app.write().favorites_only = false;
                        app.write().category_id = None;
                        begin_browse(app);
                    },
                    Icon { name: IconName::Grid, class: "sidebar-icon".to_owned() }
                    span { "All media" }
                }
                button {
                    class: if snapshot.favorites_only { "sidebar-link active" } else { "sidebar-link" },
                    r#type: "button",
                    onclick: move |_| {
                        app.write().favorites_only = true;
                        app.write().category_id = None;
                        begin_browse(app);
                    },
                    Icon { name: IconName::Heart, class: "sidebar-icon".to_owned() }
                    span { "Favorites" }
                }
            }
            div { class: "sidebar-section",
                div { class: "sidebar-heading", "Categories" }
                nav { class: "sidebar-categories",
                    if snapshot.categories.is_empty() {
                        span { class: "sidebar-empty", "No categories yet" }
                    }
                    for category in &snapshot.categories {
                        div {
                            class: if open_menu == Some(category.id) { "sidebar-category-row menu-open" } else { "sidebar-category-row" },
                            button {
                                class: if snapshot.category_id == Some(category.id) { "sidebar-link category-link category-main active" } else { "sidebar-link category-link category-main" },
                                r#type: "button",
                                style: "padding-left: {12 + category.depth.min(4) * 14}px",
                                title: category.path.as_deref().unwrap_or(&category.name),
                                onclick: { let id = category.id; move |_| {
                                    folder_menu.set(None);
                                    app.write().favorites_only = false;
                                    app.write().category_id = Some(id);
                                    begin_browse(app);
                                } },
                                span { class: "category-mark",
                                    if let Some(source) = category_artwork_url(&snapshot, category) {
                                        img { src: "{source}", alt: "", draggable: "false" }
                                    } else {
                                        Icon { name: IconName::Folder }
                                    }
                                }
                                span { class: "category-name", "{truncate_category_name(&category.name, category.depth)}" }
                                span { class: "category-count", "{category.media_count}" }
                            }
                            if category_has_media(category.media_count) {
                                button {
                                    class: "icon-button more-menu category-more",
                                    r#type: "button",
                                    title: "Folder options",
                                    "aria-label": "Folder options for {category.name}",
                                    "aria-haspopup": "menu",
                                    "aria-expanded": open_menu == Some(category.id),
                                    onclick: { let id = category.id; move |event: MouseEvent| {
                                        event.stop_propagation();
                                        folder_menu.set(if open_menu == Some(id) { None } else { Some(id) });
                                    } },
                                    Icon { name: IconName::More }
                                }
                                if open_menu == Some(category.id) {
                                    div {
                                        class: "context-menu row-context-menu below",
                                        role: "menu",
                                        "aria-label": "Options for {category.name}",
                                        onclick: move |event: MouseEvent| event.stop_propagation(),
                                        div { class: "context-menu-title", title: category.path.as_deref().unwrap_or(&category.name), "{category.name}" }
                                        button {
                                            class: "context-menu-item",
                                            r#type: "button",
                                            role: "menuitem",
                                            onclick: { let id = category.id; move |_| {
                                                folder_menu.set(None);
                                                play_folder(app, engine, id);
                                            } },
                                            span { class: "context-menu-icon", Icon { name: IconName::Play } }
                                            span { "Play {truncate_category_name(&category.name, category.depth)}" }
                                        }
                                        button {
                                            class: "context-menu-item",
                                            r#type: "button",
                                            role: "menuitem",
                                            onclick: { let id = category.id; let name = category.name.clone(); move |_| {
                                                folder_menu.set(None);
                                                append_folder(app, id, name.clone());
                                            } },
                                            span { class: "context-menu-icon", Icon { name: IconName::ListPlus } }
                                            span { "Queue {truncate_category_name(&category.name, category.depth)}" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            footer { class: "sidebar-footer",
                StatusBadge { label: access_label.to_owned(), class: access_class.to_owned() }
                button {
                    class: "sidebar-settings",
                    r#type: "button",
                    onclick: move |_| {
                        let current_url = app.read().settings.server_url.to_string();
                        app.write().settings_url = current_url;
                        app.write().settings_error = None;
                        app.write().queue_open = false;
                        app.write().settings_open = true;
                    },
                    span { class: "sidebar-settings-label",
                        Icon { name: IconName::Settings }
                        span { "Settings" }
                    }
                    span { "⌘," }
                }
                div { class: "sidebar-version", "Desktop v{version}" }
            }
        }
    }
}

pub(crate) fn category_has_media(media_count: u32) -> bool {
    media_count > 0
}

pub(crate) fn truncate_category_name(name: &str, depth: u32) -> String {
    let max_chars = match depth {
        0 => 20,
        1 => 18,
        2 => 16,
        3 => 14,
        _ => 12,
    };
    if name.chars().count() > max_chars {
        let truncated: String = name.chars().take(max_chars.saturating_sub(1)).collect();
        format!("{truncated}…")
    } else {
        name.to_owned()
    }
}
