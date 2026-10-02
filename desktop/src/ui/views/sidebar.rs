use dioxus_native::prelude::*;

use super::super::*;

#[component]
pub(crate) fn Sidebar(app: Signal<NativeApp>) -> Element {
    let snapshot = app.read().clone();
    let version = env!("CARGO_PKG_VERSION");
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
                    small { "Private media vault" }
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
                        button {
                            class: if snapshot.category_id == Some(category.id) { "sidebar-link category-link active" } else { "sidebar-link category-link" },
                            r#type: "button",
                            style: "padding-left: {12 + category.depth.min(4) * 14}px",
                            title: category.path.as_deref().unwrap_or(&category.name),
                            onclick: { let id = category.id; move |_| {
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
                            span { class: "category-name", "{category.name}" }
                            span { class: "category-count", "{category.media_count}" }
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
