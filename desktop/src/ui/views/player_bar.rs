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
    let vol_icon = if vol <= 0.0 {
        IconName::VolumeMute
    } else if vol < 0.5 {
        IconName::VolumeLow
    } else {
        IconName::Volume
    };
    let vol_label = if vol <= 0.0 {
        "Unmute (currently muted)".to_owned()
    } else {
        format!("Mute (volume {}%)", (vol * 100.0).round() as i32)
    };

    let media_badge = if media.is_video() {
        Some("VIDEO")
    } else if media.is_photo() {
        Some("PHOTO")
    } else {
        None
    };

    rsx! {
        section { class: "mini-player", "aria-label": "Media player",
            div { class: "mini-identity-wrap",
                button {
                    class: "mini-identity",
                    title: "Open full player",
                    onclick: move |_| app.write().player_expanded = true,
                    div { class: "mini-art-wrap",
                        Artwork {
                            source,
                            alt: media.title().to_owned(),
                            fallback: fallback.to_owned(),
                            class: "mini-art".to_owned()
                        }
                        if let Some(badge) = media_badge {
                            span { class: "mini-art-badge", "{badge}" }
                        }
                    }
                    span { class: "mini-copy",
                        strong { "{media.title()}" }
                        small { "{media.subtitle()}" }
                    }
                }
                if media.is_audio() {
                    IconButton {
                        label: if media.liked { "Remove from favorites".to_owned() } else { "Add to favorites".to_owned() },
                        icon: IconName::Heart,
                        class: if media.liked { "mini-fav-btn favorite active".to_owned() } else { "mini-fav-btn favorite".to_owned() },
                        onclick: { let liked = !media.liked; move |_| set_favorite(app, liked) }
                    }
                }
            }
            div { class: "mini-transport",
                div { class: "transport-buttons",
                    if !media.is_photo() {
                        IconButton {
                            label: if playback.shuffle { "Shuffle: on".to_owned() } else { "Shuffle: off".to_owned() },
                            icon: IconName::Shuffle,
                            class: if playback.shuffle { "active".to_owned() } else { String::new() },
                            onclick: move |_| toggle_shuffle(app)
                        }
                    }
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
                    if !media.is_photo() {
                        IconButton {
                            label: repeat_title,
                            icon: repeat_icon,
                            class: if repeat_active { "active".to_owned() } else { String::new() },
                            onclick: move |_| toggle_repeat(app)
                        }
                    }
                }
                if !media.is_photo() {
                    MusicProgress {
                        position: playback.position,
                        duration: playback.duration,
                        onseek: move |position| seek(app, engine, position),
                    }
                }
            }
            div { class: "mini-tools",
                if !media.is_photo() {
                    QualityPopover {
                        app,
                        engine,
                        quality: playback.quality,
                        is_video: media.is_video(),
                    }
                }
                if !media.is_photo() {
                    div { class: "mini-volume",
                        IconButton {
                            label: vol_label,
                            icon: vol_icon,
                            class: "volume-btn".to_owned(),
                            onclick: move |_| toggle_mute(app, engine)
                        }
                        input {
                            class: "volume-slider",
                            r#type: "range",
                            min: "0",
                            max: "1",
                            step: "0.01",
                            value: "{vol}",
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
                IconButton { label: "Stop playback".to_owned(), icon: IconName::Stop, class: "stop-btn".to_owned(), onclick: move |_| stop_playback(app, engine) }
            }
        }
    }
}

pub(crate) fn quality_badge(quality: Quality) -> &'static str {
    match quality {
        Quality::Ori => "ORI",
        Quality::High => "HD",
        Quality::Med => "MED",
        Quality::Low => "LOW",
    }
}

pub(crate) fn quality_description(quality: Quality, is_video: bool) -> &'static str {
    if is_video {
        match quality {
            Quality::Ori => "Original source",
            Quality::High => "1080p • Highest",
            Quality::Med => "720p • Balanced",
            Quality::Low => "480p • Data saver",
        }
    } else {
        match quality {
            Quality::Ori => "Lossless source",
            Quality::High => "256 kbps • High",
            Quality::Med => "160 kbps • Standard",
            Quality::Low => "96 kbps • Efficient",
        }
    }
}

#[component]
fn QualityOption(
    opt: Quality,
    is_active: bool,
    is_video: bool,
    onselect: EventHandler<Quality>,
) -> Element {
    let mut ctx = use_context::<PopoverContext>();

    rsx! {
        button {
            r#type: "button",
            class: if is_active { "quality-option-item active" } else { "quality-option-item" },
            onclick: move |_| {
                ctx.open.set(false);
                onselect.call(opt);
            },
            div { class: "quality-item-info",
                span { class: "quality-item-name", "{opt}" }
                span { class: "quality-item-desc", "{quality_description(opt, is_video)}" }
            }
            span { class: "quality-item-tag", "{quality_badge(opt)}" }
        }
    }
}

#[component]
pub(crate) fn QualityPopover(
    app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
    quality: Quality,
    is_video: bool,
    #[props(default = PopoverSide::Top)] side: PopoverSide,
    #[props(default = PopoverAlign::End)] align: PopoverAlign,
) -> Element {
    let active_badge = quality_badge(quality);

    rsx! {
        Popover {
            align,
            side,
            PopoverTrigger {
                class: "mini-quality-btn".to_owned(),
                aria_label: format!("Quality: {quality}"),
                span { class: "quality-badge-text", "{active_badge}" }
            }
            PopoverContent {
                class: "quality-popover-content".to_owned(),
                PopoverTitle { "Stream Quality" }
                PopoverDescription { "{quality_description(quality, is_video)}" }
                div { class: "quality-options-list",
                    for opt in [Quality::Ori, Quality::High, Quality::Med, Quality::Low] {
                        QualityOption {
                            opt,
                            is_active: quality == opt,
                            is_video,
                            onselect: move |selected| change_quality(app, engine, selected),
                        }
                    }
                }
            }
        }
    }
}
