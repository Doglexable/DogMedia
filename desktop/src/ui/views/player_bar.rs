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
    let session_unavailable = playback.session_unavailable;
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

    let media_badge = if media.is_video() {
        Some("VIDEO")
    } else if media.is_photo() {
        Some("PHOTO")
    } else {
        None
    };

    let holder_label = playback
        .holder
        .as_ref()
        .map(SessionHolder::display_label)
        .unwrap_or_else(|| "Another device".to_owned());
    let mini_player_class = if session_unavailable {
        "mini-player has-connect-bar"
    } else {
        "mini-player"
    };

    rsx! {
        section { class: "{mini_player_class}", "aria-label": "Media player",
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
                            disabled: session_unavailable,
                            onclick: move |_| toggle_shuffle(app)
                        }
                    }
                    IconButton { label: "Previous".to_owned(), icon: IconName::Previous, disabled: session_unavailable, onclick: move |_| navigate_queue(app, engine, false, false) }
                    if !media.is_photo() {
                        IconButton {
                            label: if playing { "Pause".to_owned() } else { "Play".to_owned() },
                            icon: if playing { IconName::Pause } else { IconName::Play },
                            class: "play".to_owned(),
                            disabled: session_unavailable,
                            onclick: move |_| toggle_playback(app, engine)
                        }
                    }
                    IconButton { label: "Next".to_owned(), icon: IconName::Next, disabled: session_unavailable, onclick: move |_| navigate_queue(app, engine, true, false) }
                    if !media.is_photo() {
                        IconButton {
                            label: repeat_title,
                            icon: repeat_icon,
                            class: if repeat_active { "active".to_owned() } else { String::new() },
                            disabled: session_unavailable,
                            onclick: move |_| toggle_repeat(app)
                        }
                    }
                }
                if !media.is_photo() {
                    MusicProgress {
                        position: playback.position,
                        duration: playback.duration,
                        variant: SliderVariant::Round,
                        disabled: session_unavailable,
                        onseek: move |position| seek(app, engine, position),
                    }
                }
            }
            div { class: "mini-tools",
                if !media.is_photo() {
                    QualityPopover {
                        app,
                        quality: playback.quality,
                        disabled: session_unavailable,
                    }
                }
                if !media.is_photo() {
                    VolumePopover {
                        app,
                        engine,
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
            if session_unavailable {
                div {
                    class: "spotify-connect-bar",
                    role: "status",
                    if can_take_over_playback(snapshot.access_tier) {
                        button {
                            class: "spotify-connect-takeover-btn",
                            r#type: "button",
                            disabled: snapshot.session_takeover_pending,
                            onclick: move |event: MouseEvent| {
                                event.stop_propagation();
                                take_over_playback(app, engine);
                            },
                            if snapshot.session_takeover_pending { "Moving playback…" } else { "Play here" }
                        }
                    }
                    div {
                        class: "spotify-connect-status",
                        span { class: "spotify-connect-icon", Icon { name: IconName::Volume } }
                        span { class: "spotify-connect-label", "Playing on {holder_label}" }
                    }
                }
            }
        }
    }
}

/// Minimum access tier allowed to force-take the exclusive playback lease
/// (mirrors the server `DELETE /api/playback/lease/admin` tier gate).
pub(crate) const SESSION_TAKEOVER_MIN_TIER: i32 = 100;

/// Whether the "Play here" takeover action may be offered at `tier`.
/// Standard clients see holder details and retry guidance instead.
pub(crate) fn can_take_over_playback(tier: i32) -> bool {
    tier >= SESSION_TAKEOVER_MIN_TIER
}

#[component]
pub(crate) fn SessionConflictCard(
    holder: Option<SessionHolder>,
    retry_after: Option<u64>,
) -> Element {
    let label = holder
        .as_ref()
        .map(SessionHolder::display_label)
        .unwrap_or_else(|| "Another device".to_owned());
    let countdown = holder
        .as_ref()
        .and_then(|value| value.expires_in)
        .or(retry_after)
        .map(|seconds| format!("Available in about {seconds}s"));
    rsx! {
        div {
            "data-name": "SessionConflictCard",
            class: "session-conflict-card",
            role: "alert",
            strong { "Playback is active elsewhere" }
            span { "{label} is playing this library" }
            if let Some(countdown) = countdown {
                span { class: "conflict-countdown", "{countdown}" }
            }
        }
    }
}

#[component]
pub(crate) fn SessionTakeoverButton(
    app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
) -> Element {
    let pending = app.read().session_takeover_pending;
    rsx! {
        Button {
            label: if pending { "Moving playback…".to_owned() } else { "Play here".to_owned() },
            icon: IconName::Refresh,
            class: "session-takeover-btn".to_owned(),
            disabled: pending,
            onclick: move |_| take_over_playback(app, engine),
        }
    }
}

pub(crate) fn quality_badge(quality: Quality) -> &'static str {
    match quality {
        Quality::Ori => "VH",
        Quality::High => "HD",
        Quality::Med => "MED",
        Quality::Low => "LOW",
    }
}

pub(crate) fn quality_description(quality: Quality, is_video: bool) -> &'static str {
    if is_video {
        match quality {
            Quality::Ori => "Very high source",
            Quality::High => "1080p • Highest",
            Quality::Med => "720p • Balanced",
            Quality::Low => "480p • Data saver",
        }
    } else {
        match quality {
            Quality::Ori => "Very high source",
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
    rsx! {
        button {
            r#type: "button",
            class: if is_active { "player-quality-preset player-quality-preset--active" } else { "player-quality-preset" },
            onclick: move |event: MouseEvent| {
                event.stop_propagation();
                onselect.call(opt);
            },
            div { class: "player-quality-preset-info",
                span { class: "player-quality-preset-name", "{opt}" }
                span { class: "player-quality-preset-bitrate", "{quality_description(opt, is_video)}" }
            }
            span { class: "player-quality-preset-tag", "{quality_badge(opt)}" }
        }
    }
}

#[component]
pub(crate) fn QualityPopover(
    mut app: Signal<NativeApp>,
    quality: Quality,
    #[props(default = false)] disabled: bool,
) -> Element {
    let active_badge = quality_badge(quality);
    let is_modified = quality != Quality::Ori;
    let is_open = app.read().quality_popover_open;

    rsx! {
        button {
            r#type: "button",
            class: if is_modified || is_open { "player-quality-btn player-quality-btn--modified" } else { "player-quality-btn" },
            aria_label: format!("Quality: {quality}"),
            "aria-expanded": "{is_open}",
            "aria-haspopup": "dialog",
            disabled,
            onclick: move |event: MouseEvent| {
                event.stop_propagation();
                let open = app.read().quality_popover_open;
                app.write().quality_popover_open = !open;
            },
            Icon { name: IconName::Signal }
            if is_modified || is_open {
                span { class: "player-quality-badge", "{active_badge}" }
            }
        }
    }
}

#[component]
pub(crate) fn QualityOverlay(
    mut app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
    quality: Quality,
    is_video: bool,
    expanded: bool,
    has_lyrics: bool,
) -> Element {
    let active_desc = quality_description(quality, is_video);
    let layer_class = if !expanded {
        "quality-layer quality-layer--mini"
    } else if is_video {
        "quality-layer quality-layer--video"
    } else if has_lyrics {
        "quality-layer quality-layer--full quality-layer--full-with-lyrics"
    } else {
        "quality-layer quality-layer--full"
    };

    rsx! {
        div {
            class: layer_class,
            tabindex: "0",
            autofocus: true,
            role: "presentation",
            onkeydown: move |event: KeyboardEvent| {
                if event.key() == Key::Escape {
                    event.stop_propagation();
                    app.write().quality_popover_open = false;
                }
            },
            onclick: move |event: MouseEvent| {
                event.stop_propagation();
                app.write().quality_popover_open = false;
            },
            div {
                class: "quality-layer-card",
                role: "dialog",
                "aria-label": "Playback quality",
                onclick: move |event: MouseEvent| event.stop_propagation(),
                div { class: "player-quality-popover",
                    div { class: "player-quality-header",
                        span { "Quality" }
                        span { class: "player-quality-bitrate-active", "{active_desc}" }
                    }
                    div { class: "player-quality-presets",
                        for opt in [Quality::Ori, Quality::High, Quality::Med, Quality::Low] {
                            QualityOption {
                                opt,
                                is_active: quality == opt,
                                is_video,
                                onselect: move |selected| {
                                    app.write().quality_popover_open = false;
                                    change_quality(app, engine, selected);
                                },
                            }
                        }
                    }
                }
            }
        }
    }
}

#[component]
pub(crate) fn VolumePopover(
    app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
    #[props(default = PopoverSide::Top)] side: PopoverSide,
    #[props(default = PopoverAlign::Center)] align: PopoverAlign,
) -> Element {
    let vol = app.read().settings.volume.get();
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

    rsx! {
        Popover {
            align,
            side,
            PopoverTrigger {
                class: if is_muted { "player-volume-button player-volume-control--muted" } else { "player-volume-button" },
                aria_label: vol_label.clone(),
                ondoubleclick: move |_| toggle_mute(app, engine),
                Icon { name: vol_icon }
            }
            PopoverContent {
                class: "player-volume-popover-content".to_owned(),
                div {
                    class: "player-volume-popover",
                    button {
                        r#type: "button",
                        class: "player-volume-popover-mute",
                        title: if is_muted { "Unmute" } else { "Mute" },
                        aria_label: if is_muted { "Unmute" } else { "Mute" },
                        onclick: move |_| toggle_mute(app, engine),
                        Icon { name: vol_icon }
                    }
                    VolumeSlider {
                        class: "player-volume-range",
                        value: vol,
                        onchange: move |value| set_volume(app, engine, value),
                    }
                    span { class: "player-volume-percent-label", "{vol_percent}%" }
                }
            }
        }
    }
}
