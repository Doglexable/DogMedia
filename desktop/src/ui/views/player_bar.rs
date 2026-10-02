use dioxus_native::prelude::*;

use super::super::*;

#[component]
pub(crate) fn PlayerBar(app: Signal<NativeApp>, engine: Signal<Option<PlaybackEngine>>) -> Element {
    let snapshot = app.read().clone();
    let playback = snapshot.coordinator.snapshot();
    let Some(media) = playback.media.as_ref() else {
        return rsx! {};
    };
    let playing = playback.status == PlaybackStatus::Playing;
    let source = if media.is_photo() {
        snapshot.photo_data_url.clone()
    } else {
        artwork_url(&snapshot, media)
    };
    let fallback = if media.is_video() {
        "▶"
    } else if media.is_photo() {
        "▧"
    } else {
        "♪"
    };

    rsx! {
        section { class: "mini-player", "aria-label": "Media player",
            button {
                class: "mini-identity",
                title: "Open full player",
                onclick: move |_| app.write().player_expanded = true,
                Artwork {
                    source,
                    alt: media.title().to_owned(),
                    fallback: fallback.to_owned(),
                    class: "mini-art".to_owned()
                }
                span { class: "mini-copy",
                    strong { "{media.title()}" }
                    small { "{media.subtitle()}" }
                }
            }
            div { class: "mini-transport",
                div { class: "transport-buttons",
                    IconButton { label: "Previous".to_owned(), icon: IconName::Previous, onclick: move |_| navigate_queue(app, engine, false, false) }
                    if !media.is_photo() {
                        IconButton {
                            label: if playing { "Pause".to_owned() } else { "Play".to_owned() },
                            icon: if playing { IconName::Pause } else { IconName::Play },
                            class: "play".to_owned(),
                            onclick: move |_| toggle_playback(app, engine)
                        }
                    }
                    IconButton { label: "Next".to_owned(), icon: IconName::Next, onclick: move |_| navigate_queue(app, engine, true, false) }
                }
                if !media.is_photo() {
                    div { class: "mini-progress",
                        span { "{format_duration(Some(playback.position))}" }
                        input {
                            r#type: "range",
                            min: "0",
                            max: "{playback.duration.max(1.0)}",
                            step: "0.1",
                            value: "{playback.position.min(playback.duration.max(1.0))}",
                            "aria-label": "Playback position",
                            oninput: move |event| if let Ok(position) = event.value().parse() { seek(app, engine, position); }
                        }
                        span { "{format_duration(Some(playback.duration))}" }
                    }
                }
            }
            div { class: "mini-tools",
                if !media.is_photo() {
                    Select {
                        value: "{playback.quality.as_str()}",
                        onchange: move |event: FormEvent| if let Ok(quality) = event.value().parse() { change_quality(app, engine, quality); },
                        for quality in Quality::ALL {
                            option { value: "{quality.as_str()}", "{quality}" }
                        }
                    }
                }
                if media.is_audio() {
                    IconButton {
                        label: if media.liked { "Remove from favorites".to_owned() } else { "Add to favorites".to_owned() },
                        icon: IconName::Heart,
                        class: if media.liked { "favorite active".to_owned() } else { "favorite".to_owned() },
                        onclick: { let liked = !media.liked; move |_| set_favorite(app, liked) }
                    }
                }
                if !media.is_photo() {
                    label { class: "mini-volume",
                        span { "Vol" }
                        input {
                            r#type: "range",
                            min: "0",
                            max: "1",
                            step: "0.01",
                            value: "{snapshot.settings.volume.get()}",
                            "aria-label": "Volume",
                            oninput: move |event| if let Ok(volume) = event.value().parse() { set_volume(app, engine, volume); }
                        }
                    }
                }
                IconButton {
                    label: "Queue".to_owned(),
                    icon: IconName::List,
                    class: if snapshot.queue_open { "active".to_owned() } else { String::new() },
                    onclick: move |_| { let open = app.read().queue_open; app.write().queue_open = !open; }
                }
                IconButton { label: "Open full player".to_owned(), icon: IconName::Expand, onclick: move |_| app.write().player_expanded = true }
                IconButton { label: "Stop playback".to_owned(), icon: IconName::Stop, onclick: move |_| stop_playback(app, engine) }
            }
        }
    }
}
