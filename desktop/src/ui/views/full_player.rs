use dioxus_native::prelude::*;

use super::super::*;
use super::VideoPlayer;
use super::{QualityPopover, SessionConflictCard};

#[component]
pub(crate) fn FullPlayer(
    app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
    video_source_id: u64,
) -> Element {
    let snapshot = app.read();
    let playback = snapshot.coordinator.snapshot();
    let Some(media) = playback.media.as_ref() else {
        return rsx! {};
    };
    if media.is_video() {
        return rsx! {
            VideoPlayer {
                app,
                engine,
                video_source_id,
            }
        };
    }
    let playing = playback.status == PlaybackStatus::Playing;
    let session_unavailable = playback.session_unavailable;
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
    let lyrics_open = snapshot.lyrics_visible;
    let source = artwork_url(&snapshot, media);
    let fallback = if media.is_video() {
        "▶"
    } else if media.is_photo() {
        "▧"
    } else {
        "♪"
    };

    let repeat_icon = match playback.repeat {
        RepeatMode::One => IconName::RepeatOne,
        _ => IconName::Repeat,
    };
    let repeat_active = playback.repeat != RepeatMode::None;
    let repeat_title = match playback.repeat {
        RepeatMode::None => "Repeat: off".to_owned(),
        RepeatMode::Queue => "Repeat: all".to_owned(),
        RepeatMode::One => "Repeat: one".to_owned(),
    };

    let vol = snapshot.settings.volume.get();
    let vol_percent = (vol * 100.0).round() as i32;
    let is_muted = vol <= 0.0;
    let vol_icon = if is_muted {
        IconName::VolumeMute
    } else if vol < 0.5 {
        IconName::VolumeLow
    } else {
        IconName::Volume
    };
    let vol_label = if is_muted {
        "Volume (Muted)".to_owned()
    } else {
        format!("Volume {vol_percent}%")
    };

    let is_photo = media.is_photo();
    let on_key_down = move |event: KeyboardEvent| {
        event.stop_propagation();
        match event.key() {
            Key::Escape => {
                app.write().player_expanded = false;
            }
            Key::Character(ref ch) if ch == " " || ch == "k" || ch == "K" => {
                if !is_photo {
                    toggle_playback(app, engine);
                }
            }
            Key::ArrowLeft => {
                if !is_photo {
                    skip_seconds(app, engine, -10.0);
                }
            }
            Key::ArrowRight => {
                if !is_photo {
                    skip_seconds(app, engine, 10.0);
                }
            }
            Key::Character(ref ch) if ch == "j" || ch == "J" => {
                if !is_photo {
                    skip_seconds(app, engine, -10.0);
                }
            }
            Key::Character(ref ch) if ch == "l" || ch == "L" => {
                if !is_photo {
                    skip_seconds(app, engine, 10.0);
                }
            }
            Key::ArrowUp => {
                let new_vol = (vol + 0.1).min(1.0);
                set_volume(app, engine, new_vol);
            }
            Key::ArrowDown => {
                let new_vol = (vol - 0.1).max(0.0);
                set_volume(app, engine, new_vol);
            }
            Key::Character(ref ch) if ch == "m" || ch == "M" => {
                toggle_mute(app, engine);
            }
            Key::Character(ref ch) if ch == "n" || ch == "N" => {
                navigate_queue(app, engine, true, false);
            }
            Key::Character(ref ch) if ch == "p" || ch == "P" => {
                navigate_queue(app, engine, false, false);
            }
            Key::Character(ref ch) if ch == "s" || ch == "S" => {
                if !is_photo {
                    toggle_shuffle(app);
                }
            }
            Key::Character(ref ch) if ch == "r" || ch == "R" => {
                if !is_photo {
                    toggle_repeat(app);
                }
            }
            Key::Character(ref ch) if ch == "q" || ch == "Q" => {
                let open = app.read().queue_open;
                app.write().queue_open = !open;
            }
            _ => {}
        }
    };

    rsx! {
        section {
            class: if snapshot.queue_open { "full-player has-queue-sidebar" } else { "full-player" },
            "aria-label": "Full player",
            tabindex: "0",
            autofocus: true,
            onkeydown: on_key_down,
            if !snapshot.queue_open
                && !snapshot.quality_popover_open
                && !snapshot.settings_open
            {
                div {
                    class: "keyboard-focus-sink",
                    tabindex: "-1",
                    autofocus: true,
                    "aria-hidden": "true",
                }
            }
            IconButton {
                label: "Close full player".to_owned(),
                icon: IconName::ChevronDown,
                class: "full-close".to_owned(),
                onclick: move |_| app.write().player_expanded = false
            }
            div { class: if lyrics_open { "full-layout" } else { "full-layout no-lyrics" },
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
                        p {
                            title: "{media.category_path.as_deref().or(media.category_name.as_deref()).unwrap_or(\"Library\")}",
                            "{media_folder(media)}"
                        }
                        h1 { "{media.title()}" }
                        span { "{media.subtitle()}" }
                    }
                    if !media.is_photo() {
                        MusicProgress {
                            position: playback.position,
                            duration: playback.duration,
                            class: "full-music-progress".to_owned(),
                            disabled: session_unavailable,
                            onseek: move |position| seek(app, engine, position),
                        }
                    }
                    div { class: "full-controls",
                        if !media.is_photo() {
                            IconButton {
                                label: if playback.shuffle { "Shuffle: on".to_owned() } else { "Shuffle: off".to_owned() },
                                icon: IconName::Shuffle,
                                class: if playback.shuffle { "transport active".to_owned() } else { "transport".to_owned() },
                                disabled: session_unavailable,
                                onclick: move |_| toggle_shuffle(app)
                            }
                        }
                        IconButton { label: "Previous".to_owned(), icon: IconName::Previous, class: "transport".to_owned(), disabled: session_unavailable, onclick: move |_| navigate_queue(app, engine, false, false) }
                        if !media.is_photo() {
                            IconButton {
                                label: if playing { "Pause".to_owned() } else { "Play".to_owned() },
                                icon: if playing { IconName::Pause } else { IconName::Play },
                                class: "full-play".to_owned(),
                                disabled: session_unavailable,
                                onclick: move |_| toggle_playback(app, engine)
                            }
                        }
                        IconButton { label: "Next".to_owned(), icon: IconName::Next, class: "transport".to_owned(), disabled: session_unavailable, onclick: move |_| navigate_queue(app, engine, true, false) }
                        if !media.is_photo() {
                            IconButton {
                                label: repeat_title,
                                icon: repeat_icon,
                                class: if repeat_active { "transport active".to_owned() } else { "transport".to_owned() },
                                disabled: session_unavailable,
                                onclick: move |_| toggle_repeat(app)
                            }
                        }
                    }
                    if !media.is_photo() {
                        div {
                            class: "full-volume",
                            IconButton {
                                label: vol_label,
                                icon: vol_icon,
                                class: if is_muted { "full-volume-btn muted".to_owned() } else { "full-volume-btn".to_owned() },
                                onclick: move |_| toggle_mute(app, engine),
                            }
                            VolumeSlider {
                                class: "full-volume-range",
                                value: vol,
                                onchange: move |value| set_volume(app, engine, value),
                            }
                        }
                    }
                    div { class: "full-tools",
                        if media.is_audio() {
                            IconButton {
                                label: if media.liked { "Remove from favorites".to_owned() } else { "Add to favorites".to_owned() },
                                icon: IconName::Heart,
                                class: if media.liked { "favorite active".to_owned() } else { "favorite".to_owned() },
                                onclick: { let liked = !media.liked; move |_| set_favorite(app, liked) }
                            }
                            IconButton {
                                label: if lyrics_open { "Hide lyrics".to_owned() } else { "Show lyrics".to_owned() },
                                icon: IconName::Lyrics,
                                class: if lyrics_open { "lyrics-toggle active".to_owned() } else { "lyrics-toggle".to_owned() },
                                onclick: move |_| {
                                    let visible = app.read().lyrics_visible;
                                    app.write().lyrics_visible = !visible;
                                },
                            }
                        }
                        if !media.is_photo() {
                            QualityPopover {
                                app,
                                quality: playback.quality,
                                disabled: session_unavailable,
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
                if lyrics_open {
                    aside { class: "lyrics-panel", "aria-label": "Lyrics",
                        p { class: "eyebrow", "Lyrics" }
                        div { class: "lyrics-lines",
                            if has_lyrics {
                                for line in lyrics.iter() { p { "{line}" } }
                            } else {
                                p { class: "lyrics-empty", "No lyrics available for this track" }
                            }
                        }
                    }
                }
            }
            if session_unavailable {
                SessionConflictCard {
                    holder: playback.holder.clone(),
                    app: Some(app),
                    engine: Some(engine),
                }
            }
        }
    }
}
