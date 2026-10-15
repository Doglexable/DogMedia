use dioxus_native::prelude::*;

use super::super::*;
use super::VideoPlayer;
use super::{LyricsShareDialog, QualityPopover, SessionConflictCard};
use crate::domain::{
    DisplayLyricSegment, build_lyrics_display_segments, find_active_lyrics_index,
    find_lyrics_focus_index,
};

#[component]
pub(crate) fn FullPlayer(
    app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
    video_source_id: u64,
) -> Element {
    let mut share_open = use_signal(|| false);
    let mut shadow_palette = use_signal(|| None::<(MediaId, Option<String>, String)>);
    let snapshot = app.read();
    let playback = snapshot.coordinator.snapshot();
    let palette_key = playback
        .media
        .as_ref()
        .filter(|media| media.is_audio() && !snapshot.local_mode)
        .map(|media| (media.id, media.artwork_version.clone()));
    let client = snapshot.client.clone();
    use_effect(use_reactive((&palette_key,), move |(key,)| {
        if let (Some((media_id, version)), Some(client)) = (key, client.clone()) {
            spawn(async move {
                if let Ok(palette) = client.artwork_palette(media_id).await {
                    if let Some(hex) = palette.colors.get(2).map(|color| &color.hex)
                        && crate::ui::lyrics_card::parse_hex(hex).is_some()
                    {
                        shadow_palette.set(Some((media_id, version, hex.clone())));
                    }
                }
            });
        }
    }));
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
    let raw_lyrics = snapshot.lyrics.clone();
    let has_lyrics = !raw_lyrics.is_empty();
    let has_shareable_lyrics = raw_lyrics.iter().any(|line| !line.text.trim().is_empty());
    let display_segments = build_lyrics_display_segments(&raw_lyrics);
    let lyrics_open = snapshot.lyrics_visible;
    let source = artwork_url(&snapshot, media);
    let share_artwork = source.as_ref().map(|value| value.as_str().to_owned());
    let shadow_color = shadow_palette()
        .filter(|(id, version, _)| *id == media.id && *version == media.artwork_version && !snapshot.local_mode)
        .map(|(_, _, hex)| hex);
    let shadow_style = shadow_color.as_ref()
        .map(|hex| format!("--full-art-shadow-color: {hex};"))
        .unwrap_or_default();
    let player_class = format!(
        "full-player{}{}",
        if snapshot.queue_open { " has-queue-sidebar" } else { "" },
        if shadow_color.is_some() { " has-palette-shadow" } else { "" },
    );
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
            class: "{player_class}",
            style: "{shadow_style}",
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
            div {
                class: "full-player-body",
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
                            IconButton {
                                label: "Share lyrics".to_owned(),
                                icon: IconName::Share,
                                class: "share-lyrics".to_owned(),
                                onclick: move |_| share_open.set(true),
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
                        div { class: "lyrics-header",
                            p { class: "eyebrow", "Lyrics" }
                            div { class: "lyrics-header-actions",
                                if has_shareable_lyrics {
                                    button {
                                        class: "lyrics-share-trigger",
                                        title: "Share lyrics as a 16:9 image",
                                        onclick: move |_| share_open.set(true),
                                        "Share lyrics"
                                    }
                                }
                                button {
                                    class: "lyrics-credit",
                                    title: "Lyrics provided by LRCLIB (https://lrclib.net/)",
                                    onclick: move |_| open_external_url("https://lrclib.net/"),
                                    span { "Lyrics by " }
                                    strong { "LRCLIB" }
                                }
                            }
                        }
                        if has_lyrics {
                            LyricsView {
                                app,
                                engine,
                                segments: display_segments,
                            }
                        } else {
                            div { class: "lyrics-lines",
                                p { class: "lyrics-empty", "No lyrics available for this track" }
                            }
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
            if share_open() {
                LyricsShareDialog {
                    key: "{media.id}",
                    app,
                    open: share_open,
                    media: media.clone(),
                    segments: raw_lyrics,
                    position: playback.position,
                    preview_artwork: share_artwork,
                }
            }
        }
    }
}

#[component]
fn LyricsView(
    app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
    segments: Vec<DisplayLyricSegment>,
) -> Element {
    let timing = try_consume_context::<Signal<PlaybackTiming>>();
    let position = timing.map(|t| t.read().position).unwrap_or(0.0);

    let active_index = find_active_lyrics_index(&segments, position);
    let focus_index = find_lyrics_focus_index(&segments, position);

    let item_height = 60.0;
    let target_offset = if focus_index > 0 {
        ((focus_index as f64 - 1.0) * item_height).max(0.0)
    } else {
        0.0
    };
    let track_style = if target_offset > 0.0 {
        format!("margin-top: -{target_offset:.1}px;")
    } else {
        "margin-top: 0px;".to_string()
    };

    rsx! {
        div { class: "lyrics-lines",
            div {
                class: "lyrics-scroll-track",
                style: "{track_style}",
                for (index, segment) in segments.iter().enumerate() {
                    {
                        let is_active = Some(index) == active_index;
                        let is_instrumental = segment.instrumental;
                        let class_name = if is_active {
                            if is_instrumental {
                                "lyrics-line active instrumental"
                            } else {
                                "lyrics-line active"
                            }
                        } else if is_instrumental {
                            "lyrics-line instrumental"
                        } else {
                            "lyrics-line"
                        };
                        let start = segment.start;
                        let text = segment.text.clone();
                        rsx! {
                            button {
                                key: "{segment.start}-{index}",
                                class: "{class_name}",
                                "aria-current": if is_active { "true" } else { "false" },
                                onclick: move |_| {
                                    seek(app, engine, start);
                                },
                                if is_instrumental {
                                    span { "♪ {text}" }
                                } else {
                                    span { "{text}" }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

fn open_external_url(url: &str) {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd").args(["/c", "start", "", url]).spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(url).spawn();
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    }
}
