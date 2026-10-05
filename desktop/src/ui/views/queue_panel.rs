use dioxus_native::prelude::*;

use super::super::*;

#[component]
pub(crate) fn QueuePanel(
    app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
) -> Element {
    let snapshot = app.read().clone();
    let mut dragging_id = use_signal(|| None::<MediaId>);
    let mut drag_over_id = use_signal(|| None::<MediaId>);

    let queue_window = snapshot.queue.as_ref();
    let active_id = queue_window
        .and_then(|q| q.current_media_id)
        .or_else(|| snapshot.coordinator.snapshot().media.as_ref().map(|m| m.id));

    let (pinned_item, previous_items, upcoming_items, displayed_total) = match queue_window {
        Some(queue) => {
            let pinned_index =
                active_id.and_then(|id| queue.items.iter().position(|item| item.media.id == id));
            let (pinned, previous, upcoming) = match pinned_index {
                Some(idx) => (
                    Some(queue.items[idx].clone()),
                    queue.items[..idx].to_vec(),
                    queue.items[idx + 1..].to_vec(),
                ),
                None => (None, Vec::new(), queue.items.clone()),
            };
            let count = if pinned.is_some() {
                upcoming.len() + 1
            } else {
                upcoming.len()
            };
            (pinned, previous, upcoming, count)
        }
        None => (None, Vec::new(), Vec::new(), 0),
    };

    let count_label = if displayed_total == 1 {
        "1 item queued".to_string()
    } else if displayed_total > 0 {
        format!("{displayed_total} items queued")
    } else {
        "No items queued".to_string()
    };

    let reorder = {
        let previous = previous_items.clone();
        let pinned = pinned_item.clone();
        let upcoming = upcoming_items.clone();
        move |from_id: MediaId, to_id: MediaId| {
            if from_id == to_id {
                return;
            }
            let mut upcoming_ids: Vec<MediaId> = upcoming.iter().map(|it| it.media.id).collect();
            if let (Some(from_idx), Some(to_idx)) = (
                upcoming_ids.iter().position(|&id| id == from_id),
                upcoming_ids.iter().position(|&id| id == to_id),
            ) {
                let moved = upcoming_ids.remove(from_idx);
                upcoming_ids.insert(to_idx, moved);

                let mut next_ids = Vec::with_capacity(
                    previous.len() + pinned.as_ref().map_or(0, |_| 1) + upcoming_ids.len(),
                );
                for prev in &previous {
                    next_ids.push(prev.media.id);
                }
                if let Some(ref p) = pinned {
                    next_ids.push(p.media.id);
                }
                next_ids.extend(upcoming_ids);
                queue_reorder(app, next_ids);
            }
        }
    };

    rsx! {
        aside {
            class: "queue-panel",
            "aria-label": "Playback queue",
            tabindex: "0",
            autofocus: true,
            onkeydown: move |event: KeyboardEvent| {
                if event.key() == Key::Escape {
                    event.stop_propagation();
                    app.write().queue_open = false;
                }
            },
            header { class: "panel-header",
                div {
                    p { class: "eyebrow", "Up next" }
                    h2 { "Queue" }
                    span { "{count_label}" }
                }
                div { class: "panel-header-actions",
                    if displayed_total > 0 {
                        button {
                            r#type: "button",
                            class: "queue-clear-btn",
                            title: "Clear all items from queue",
                            onclick: move |_| queue_clear(app),
                            "Clear"
                        }
                    }
                }
            }
            div { class: "queue-list",
                if queue_window.is_some() {
                    if displayed_total == 0 {
                        div { class: "queue-empty", "Queue is empty." }
                    } else {
                        Draggable {
                            class: "queue-draggable-root".to_owned(),
                            if let Some(item) = pinned_item.as_ref() {
                                div {
                                    class: "queue-item active pinned",
                                    button {
                                        r#type: "button",
                                        class: "queue-grip-btn locked",
                                        disabled: true,
                                        title: "Now playing — locked in place",
                                        "aria-label": format!("{} is currently playing and cannot be moved", item.media.title()),
                                        Icon { name: IconName::GripVertical }
                                    }
                                    button {
                                        r#type: "button",
                                        class: "queue-select",
                                        title: item.media.title().to_owned(),
                                        onclick: { let id = item.media.id; move |_| select_queue(app, engine, id) },
                                        span { class: "queue-copy",
                                            strong { "{item.media.title()}" }
                                            small { title: "Now Playing · Locked", "Now Playing · Locked" }
                                        }
                                    }
                                    span { class: "duration", "{format_duration(item.media.duration)}" }
                                    IconButton {
                                        label: format!("Remove {} from queue", item.media.title()),
                                        icon: IconName::Close,
                                        class: "queue-remove".to_owned(),
                                        onclick: { let id = item.media.id; move |event: MouseEvent| {
                                            event.stop_propagation();
                                            queue_remove(app, id);
                                        } }
                                    }
                                }
                            }
                            if !upcoming_items.is_empty() {
                                DraggableZone {
                                    class: "queue-draggable-zone".to_owned(),
                                    for (index, item) in upcoming_items.iter().enumerate() {
                                        {
                                            let item_id = item.media.id;
                                            let is_dragging = *dragging_id.read() == Some(item_id);
                                            let is_drag_over = *drag_over_id.read() == Some(item_id);
                                            let prev_id = if index > 0 { Some(upcoming_items[index - 1].media.id) } else { None };
                                            let next_id = if index + 1 < upcoming_items.len() { Some(upcoming_items[index + 1].media.id) } else { None };

                                            rsx! {
                                                DraggableItem {
                                                    key: "{item.media.id}",
                                                    class: if is_drag_over { "queue-item sortable drag-over".to_string() } else { "queue-item sortable".to_string() },
                                                    draggable: true,
                                                    dragging: is_dragging,
                                                    drag_over: is_drag_over,
                                                    ondragstart: move |_| dragging_id.set(Some(item_id)),
                                                    ondragover: move |e: DragEvent| e.prevent_default(),
                                                    ondragenter: move |_| {
                                                        if *dragging_id.read() != Some(item_id) {
                                                            drag_over_id.set(Some(item_id));
                                                        }
                                                    },
                                                    ondragleave: move |_| {
                                                        if *drag_over_id.read() == Some(item_id) {
                                                            drag_over_id.set(None);
                                                        }
                                                    },
                                                    ondrop: {
                                                        let reorder = reorder.clone();
                                                        move |_| {
                                                            if let Some(from) = *dragging_id.read() {
                                                                reorder(from, item_id);
                                                            }
                                                            dragging_id.set(None);
                                                            drag_over_id.set(None);
                                                        }
                                                    },
                                                    ondragend: move |_| {
                                                        dragging_id.set(None);
                                                        drag_over_id.set(None);
                                                    },
                                                    onmouseenter: move |_| {
                                                        if dragging_id.read().is_some() && *dragging_id.read() != Some(item_id) {
                                                            drag_over_id.set(Some(item_id));
                                                        }
                                                    },
                                                    onmouseup: {
                                                        let reorder = reorder.clone();
                                                        move |_| {
                                                            if let Some(from) = dragging_id.take() {
                                                                reorder(from, item_id);
                                                            }
                                                            drag_over_id.set(None);
                                                        }
                                                    },
                                                    button {
                                                        r#type: "button",
                                                        class: if is_dragging { "queue-grip-btn grabbing" } else { "queue-grip-btn" },
                                                        title: "Drag to reorder (or use Arrow keys)",
                                                        "aria-label": format!("Move {}", item.media.title()),
                                                        onmousedown: move |e: MouseEvent| {
                                                            e.stop_propagation();
                                                            dragging_id.set(Some(item_id));
                                                        },
                                                        onkeydown: {
                                                            let reorder = reorder.clone();
                                                            move |e: KeyboardEvent| match e.key() {
                                                                Key::ArrowUp => {
                                                                    if let Some(target) = prev_id {
                                                                        reorder(item_id, target);
                                                                    }
                                                                }
                                                                Key::ArrowDown => {
                                                                    if let Some(target) = next_id {
                                                                        reorder(item_id, target);
                                                                    }
                                                                }
                                                                _ => {}
                                                            }
                                                        },
                                                        Icon { name: IconName::GripVertical }
                                                    }
                                                    button {
                                                        r#type: "button",
                                                        class: "queue-select",
                                                        title: item.media.title().to_owned(),
                                                        onclick: { let id = item.media.id; move |_| select_queue(app, engine, id) },
                                                        span { class: "queue-copy",
                                                            strong { "{item.media.title()}" }
                                                            small { title: "{item.media.subtitle()}", "{item.media.subtitle()}" }
                                                        }
                                                    }
                                                    span { class: "duration", "{format_duration(item.media.duration)}" }
                                                    IconButton {
                                                        label: format!("Remove {} from queue", item.media.title()),
                                                        icon: IconName::Close,
                                                        class: "queue-remove".to_owned(),
                                                        onclick: { let id = item.media.id; move |event: MouseEvent| {
                                                            event.stop_propagation();
                                                            queue_remove(app, id);
                                                        } }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            } else if pinned_item.is_some() {
                                div { class: "queue-empty-upcoming", "No upcoming items." }
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
            IconButton {
                label: "Close queue".to_owned(),
                icon: IconName::Close,
                class: "queue-panel-close".to_owned(),
                onclick: move |event: MouseEvent| {
                    event.stop_propagation();
                    app.write().queue_open = false;
                }
            }
        }
    }
}
