use dioxus_native::prelude::*;

use super::super::*;

#[component]
pub(crate) fn QueuePanel(
    app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
) -> Element {
    let snapshot = app.read().clone();
    let total = snapshot.queue.as_ref().map_or(0, |queue| queue.total);

    rsx! {
        aside { class: "queue-panel", "aria-label": "Playback queue",
            header { class: "panel-header",
                div {
                    p { class: "eyebrow", "Up next" }
                    h2 { "Queue" }
                    span { "{total} item(s) queued" }
                }
                IconButton { label: "Close queue".to_owned(), icon: IconName::Close, onclick: move |_| app.write().queue_open = false }
            }
            div { class: "queue-list",
                if let Some(queue) = snapshot.queue.as_ref() {
                    if queue.items.is_empty() {
                        div { class: "queue-empty", "Queue is empty." }
                    }
                    for item in &queue.items {
                        div { class: if Some(item.media.id) == queue.current_media_id { "queue-item active" } else { "queue-item" },
                            button {
                                class: "queue-select",
                                title: "Play {item.media.title()}",
                                onclick: { let id = item.media.id; move |_| select_queue(app, engine, id) },
                                span { class: "queue-indicator",
                                    if Some(item.media.id) == queue.current_media_id {
                                        Icon { name: IconName::Play }
                                    }
                                }
                                span { class: "queue-copy",
                                    strong { "{item.media.title()}" }
                                    if Some(item.media.id) == queue.current_media_id {
                                        small { "Now playing · Locked" }
                                    } else {
                                        small { "{item.media.subtitle()}" }
                                    }
                                }
                                span { class: "duration", "{format_duration(item.media.duration)}" }
                            }
                            IconButton {
                                label: "Remove from queue".to_owned(),
                                icon: IconName::Close,
                                class: "queue-remove".to_owned(),
                                onclick: { let id = item.media.id; move |_| queue_remove(app, id) }
                            }
                        }
                    }
                } else {
                    Skeleton {}
                }
            }
            footer { class: "queue-actions",
                Button { label: "Shuffle".to_owned(), class: "secondary".to_owned(), onclick: move |_| queue_shuffle(app) }
                Button { label: "Clear queue".to_owned(), class: "danger".to_owned(), onclick: move |_| queue_clear(app) }
            }
        }
    }
}
