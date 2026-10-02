use dioxus_native::prelude::*;

use super::super::*;

#[component]
pub(crate) fn FullPlayer(
    app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
    video_source_id: u64,
) -> Element {
    let snapshot = app.read().clone();
    let playback = snapshot.coordinator.snapshot();
    let Some(media) = playback.media.as_ref() else {
        return rsx! {};
    };
    let playing = playback.status == PlaybackStatus::Playing;
    let active_subtitle = snapshot
        .subtitle_cues
        .iter()
        .filter(|cue| playback.position >= cue.start && playback.position < cue.end)
        .map(|cue| cue.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let lyrics = snapshot
        .lyrics
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let has_lyrics = !lyrics.is_empty();
    let source = artwork_url(&snapshot, media);
    let fallback = if media.is_video() {
        "▶"
    } else if media.is_photo() {
        "▧"
    } else {
        "♪"
    };

    rsx! {
        section { class: "full-player", "aria-label": "Full player",
            IconButton {
                label: "Close full player".to_owned(),
                icon: IconName::ChevronDown,
                class: "full-close".to_owned(),
                onclick: move |_| app.write().player_expanded = false
            }
            div { class: if has_lyrics { "full-layout" } else { "full-layout no-lyrics" },
                div { class: "full-primary",
                    div { class: "full-stage",
                        if media.is_video() {
                            div { class: "video-stage",
                                canvas { class: "video-surface", "src": "{video_source_id}" }
                                if !active_subtitle.is_empty() {
                                    div { class: "subtitle-overlay", "{active_subtitle}" }
                                }
                            }
                        } else if media.is_photo() {
                            if let Some(photo) = snapshot.photo_data_url.as_ref() {
                                img { class: "full-photo", src: "{photo}", alt: "{media.title()}" }
                            } else {
                                Artwork { source, alt: media.title().to_owned(), fallback: fallback.to_owned(), class: "full-art".to_owned() }
                            }
                        } else {
                            Artwork { source, alt: media.title().to_owned(), fallback: fallback.to_owned(), class: "full-art".to_owned() }
                        }
                    }
                    div { class: "full-meta",
                        p { "{media_folder(media)}" }
                        h1 { "{media.title()}" }
                        span { "{media.subtitle()}" }
                    }
                    if !media.is_photo() {
                        div { class: "full-progress",
                            input {
                                r#type: "range",
                                min: "0",
                                max: "{playback.duration.max(1.0)}",
                                step: "0.1",
                                value: "{playback.position.min(playback.duration.max(1.0))}",
                                "aria-label": "Playback position",
                                oninput: move |event| if let Ok(position) = event.value().parse() { seek(app, engine, position); }
                            }
                            div { span { "{format_duration(Some(playback.position))}" } span { "{format_duration(Some(playback.duration))}" } }
                        }
                    }
                    div { class: "full-controls",
                        IconButton { label: "Previous".to_owned(), icon: IconName::Previous, class: "transport".to_owned(), onclick: move |_| navigate_queue(app, engine, false, false) }
                        if !media.is_photo() {
                            IconButton {
                                label: if playing { "Pause".to_owned() } else { "Play".to_owned() },
                                icon: if playing { IconName::Pause } else { IconName::Play },
                                class: "full-play".to_owned(),
                                onclick: move |_| toggle_playback(app, engine)
                            }
                        }
                        IconButton { label: "Next".to_owned(), icon: IconName::Next, class: "transport".to_owned(), onclick: move |_| navigate_queue(app, engine, true, false) }
                    }
                    div { class: "full-tools",
                        if media.is_audio() {
                            IconButton {
                                label: if media.liked { "Remove from favorites".to_owned() } else { "Add to favorites".to_owned() },
                                icon: IconName::Heart,
                                class: if media.liked { "favorite active".to_owned() } else { "favorite".to_owned() },
                                onclick: { let liked = !media.liked; move |_| set_favorite(app, liked) }
                            }
                        }
                        if !media.is_photo() {
                            Select {
                                value: "{playback.quality.as_str()}",
                                onchange: move |event: FormEvent| if let Ok(quality) = event.value().parse() { change_quality(app, engine, quality); },
                                for quality in Quality::ALL { option { value: "{quality.as_str()}", "{quality}" } }
                            }
                        }
                        IconButton {
                            label: "Queue".to_owned(), icon: IconName::List,
                            class: if snapshot.queue_open { "active".to_owned() } else { String::new() },
                            onclick: move |_| { let open = app.read().queue_open; app.write().queue_open = !open; }
                        }
                        IconButton { label: "Stop playback".to_owned(), icon: IconName::Stop, onclick: move |_| stop_playback(app, engine) }
                    }
                    if !snapshot.subtitles.is_empty() {
                        label { class: "subtitle-select",
                            span { "Subtitles" }
                            Select {
                                value: snapshot.selected_subtitle.map(|index| index.to_string()).unwrap_or_default(),
                                onchange: move |event: FormEvent| change_subtitle(app, engine, event.value().parse().ok()),
                                option { value: "", "Off" }
                                for (index, track) in snapshot.subtitles.iter().enumerate() {
                                    option { value: "{index}", {subtitle_label(track)} }
                                }
                            }
                        }
                    }
                }
                if has_lyrics {
                    aside { class: "lyrics-panel", "aria-label": "Lyrics",
                        p { class: "eyebrow", "Lyrics" }
                        div { class: "lyrics-lines",
                            for line in lyrics.iter() { p { "{line}" } }
                        }
                    }
                }
            }
        }
    }
}
