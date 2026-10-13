use dioxus_native::prelude::*;
use std::sync::Arc;
use winit::window::{Fullscreen, Window};

use super::super::*;
use super::QualityPopover;

#[component]
fn SubtitlesOverlayMenu(
    mut app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
    mut onclose: EventHandler<()>,
    mut onselect: EventHandler<Option<String>>,
) -> Element {
    let snapshot = app.read();
    let current_idx = snapshot.selected_subtitle;

    rsx! {
        div {
            class: "video-subtitles-layer",
            role: "presentation",
            onclick: move |e: MouseEvent| {
                e.stop_propagation();
                onclose.call(());
            },
            div {
                class: "video-subtitles-popover",
                role: "dialog",
                "aria-label": "Subtitles selection menu",
                onclick: move |e: MouseEvent| e.stop_propagation(),
                div { class: "video-subtitles-header",
                    span { class: "video-subtitles-title", "Subtitles / Teks" }
                }
                div { class: "video-subtitles-list", role: "radiogroup",
                    button {
                        r#type: "button",
                        class: if current_idx.is_none() { "video-subtitles-item video-subtitles-item--active" } else { "video-subtitles-item" },
                        role: "radio",
                        "aria-checked": "{current_idx.is_none()}",
                        onclick: move |e: MouseEvent| {
                            e.stop_propagation();
                            change_subtitle(app, engine, None);
                            onselect.call(None);
                            onclose.call(());
                        },
                        div { class: "video-subtitles-item-label",
                            span { class: "video-subtitles-check-slot",
                                if current_idx.is_none() {
                                    Icon { name: IconName::Check, class: "text-signal".to_owned() }
                                }
                            }
                            span { "Matikan (Off)" }
                        }
                    }
                    for (index, track) in snapshot.subtitles.iter().enumerate() {
                        {
                            let is_current = current_idx == Some(index);
                            let label = subtitle_label(track);
                            let has_ass = track.ass_url.is_some();
                            let badge_text = if has_ass { "ASS" } else { "VTT" };
                            let badge_class = if has_ass {
                                "video-sub-badge video-sub-badge--ass"
                            } else {
                                "video-sub-badge video-sub-badge--vtt"
                            };
                            let track_title = label.clone();
                            rsx! {
                                button {
                                    key: "{index}",
                                    r#type: "button",
                                    class: if is_current { "video-subtitles-item video-subtitles-item--active" } else { "video-subtitles-item" },
                                    role: "radio",
                                    "aria-checked": "{is_current}",
                                    onclick: move |e: MouseEvent| {
                                        e.stop_propagation();
                                        change_subtitle(app, engine, Some(index));
                                        onselect.call(Some(track_title.clone()));
                                        onclose.call(());
                                    },
                                    div { class: "video-subtitles-item-label",
                                        span { class: "video-subtitles-check-slot",
                                            if is_current {
                                                Icon { name: IconName::Check, class: "text-signal".to_owned() }
                                            }
                                        }
                                        span { class: "truncate", "{label}" }
                                    }
                                    span { class: "{badge_class}", "{badge_text}" }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

#[component]
pub(crate) fn VideoPlayer(
    mut app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
    video_source_id: u64,
) -> Element {
    let snapshot = app.read();
    let playback = snapshot.coordinator.snapshot();
    let Some(media) = playback.media.as_ref() else {
        return rsx! {};
    };
    let native_window = consume_context::<Arc<Window>>();
    use_hook({
        let native_window = native_window.clone();
        move || {
            native_window.set_fullscreen(Some(Fullscreen::Borderless(None)));
            tracing::info!("video player entered native fullscreen");
        }
    });
    use_drop({
        let native_window = native_window.clone();
        move || {
            native_window.set_fullscreen(None);
            tracing::info!("video player exited native fullscreen");
        }
    });
    let playing = playback.status == PlaybackStatus::Playing;
    let active_subtitle = snapshot
        .subtitle_cues
        .iter()
        .filter(|cue| playback.position >= cue.start && playback.position < cue.end)
        .map(|cue| cue.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    let show_hud = use_signal(|| true);
    let last_activity = use_signal(std::time::Instant::now);
    let subtitles_open = use_signal(|| false);
    let toast = use_signal(|| None::<(String, Option<IconName>)>);
    let toast_gen = use_signal(|| 0u64);

    use_future(move || async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            let elapsed = last_activity.read().elapsed();
            let is_playing = app.read().coordinator.snapshot().status == PlaybackStatus::Playing;
            let sub_open = *subtitles_open.read();
            let quality_open = app.read().quality_popover_open;
            let mut show_hud = show_hud;
            if is_playing
                && !sub_open
                && !quality_open
                && elapsed >= std::time::Duration::from_millis(2500)
            {
                let hud_visible = *show_hud.read();
                if hud_visible {
                    *show_hud.write() = false;
                }
            } else {
                let hud_visible = *show_hud.read();
                if !hud_visible {
                    *show_hud.write() = true;
                }
            }
        }
    });

    let show_feedback_toast = move |msg: String, icon: Option<IconName>| {
        let mut toast = toast;
        let mut toast_gen = toast_gen;
        *toast.write() = Some((msg, icon));
        let next_gen = *toast_gen.read() + 1;
        *toast_gen.write() = next_gen;
        spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(1300)).await;
            let is_current = *toast_gen.read() == next_gen;
            if is_current {
                *toast.write() = None;
            }
        });
    };

    let (has_prev, has_next) = if let Some(queue) = snapshot.queue.as_ref() {
        let repeat_queue = playback.repeat == RepeatMode::Queue;
        (
            queue.has_previous || (repeat_queue && queue.total > 1),
            queue.has_next || (repeat_queue && queue.total > 1),
        )
    } else {
        (true, true)
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

    let timing = try_consume_context::<Signal<PlaybackTiming>>();
    let timing_data = timing.map(|t| *t.read());
    let current_position = timing_data.map(|t| t.position).unwrap_or(playback.position);
    let current_duration = timing_data
        .and_then(|t| (t.duration > 0.0).then_some(t.duration))
        .unwrap_or(playback.duration)
        .max(media.duration.unwrap_or(0.0));
    let max_pos = current_duration.max(current_position).max(1.0);

    let on_activity = move || {
        let mut last_activity = last_activity;
        let mut show_hud = show_hud;
        *last_activity.write() = std::time::Instant::now();
        let hud_visible = *show_hud.read();
        if !hud_visible {
            *show_hud.write() = true;
        }
    };

    let on_key_down = {
        let show_toast = show_feedback_toast;
        move |event: KeyboardEvent| {
            event.stop_propagation();
            on_activity();
            match event.key() {
                Key::Character(ref ch) if ch == " " || ch == "k" || ch == "K" => {
                    toggle_playback(app, engine);
                }
                Key::Character(ref ch) if ch == "j" || ch == "J" => {
                    skip_seconds(app, engine, -10.0);
                    show_toast("-10s".to_owned(), Some(IconName::RotateCcw));
                }
                Key::Character(ref ch) if ch == "l" || ch == "L" => {
                    skip_seconds(app, engine, 10.0);
                    show_toast("+10s".to_owned(), Some(IconName::RotateCw));
                }
                Key::ArrowLeft => {
                    skip_seconds(app, engine, -10.0);
                    show_toast("-10s".to_owned(), Some(IconName::RotateCcw));
                }
                Key::ArrowRight => {
                    skip_seconds(app, engine, 10.0);
                    show_toast("+10s".to_owned(), Some(IconName::RotateCw));
                }
                Key::ArrowUp => {
                    let new_vol = (vol + 0.1).min(1.0);
                    set_volume(app, engine, new_vol);
                    show_toast(
                        format!("Volume {}%", (new_vol * 100.0).round() as i32),
                        Some(IconName::Volume),
                    );
                }
                Key::ArrowDown => {
                    let new_vol = (vol - 0.1).max(0.0);
                    set_volume(app, engine, new_vol);
                    let icon = if new_vol <= 0.0 {
                        IconName::VolumeMute
                    } else {
                        IconName::VolumeLow
                    };
                    show_toast(
                        format!("Volume {}%", (new_vol * 100.0).round() as i32),
                        Some(icon),
                    );
                }
                Key::Character(ref ch) if ch == "m" || ch == "M" => {
                    toggle_mute(app, engine);
                    let muted_now = app.read().settings.volume.get() <= 0.0;
                    show_toast(
                        if muted_now {
                            "Muted".to_owned()
                        } else {
                            "Unmuted".to_owned()
                        },
                        Some(if muted_now {
                            IconName::VolumeMute
                        } else {
                            IconName::Volume
                        }),
                    );
                }
                Key::Character(ref ch) if ch == "f" || ch == "F" => {
                    app.write().player_expanded = false;
                }
                Key::Character(ref ch) if ch == "n" || ch == "N" => {
                    navigate_queue(app, engine, true, false);
                }
                Key::Character(ref ch) if ch == "p" || ch == "P" => {
                    navigate_queue(app, engine, false, false);
                }
                Key::Character(ref ch) if ch == "q" || ch == "Q" => {
                    let open = app.read().queue_open;
                    app.write().queue_open = !open;
                }
                Key::Escape => {
                    app.write().player_expanded = false;
                }
                _ => {}
            }
        }
    };

    rsx! {
        div {
            class: if snapshot.queue_open { "video-player-root has-queue-sidebar" } else { "video-player-root" },
            tabindex: "0",
            autofocus: true,
            onmousemove: move |_| on_activity(),
            onkeydown: on_key_down,
            if !snapshot.queue_open
                && !snapshot.quality_popover_open
                && !snapshot.settings_open
                && !*subtitles_open.read()
            {
                div {
                    class: "keyboard-focus-sink",
                    tabindex: "-1",
                    autofocus: true,
                    "aria-hidden": "true",
                }
            }

            div { class: "video-player-ambient-glow", "aria-hidden": "true" }

            div {
                class: "video-player-stage",
                onclick: move |_| {
                    on_activity();
                    toggle_playback(app, engine);
                },
                canvas {
                    class: "video-surface video-player-video",
                    "src": "{video_source_id}",
                }
                if !active_subtitle.is_empty() {
                    div { class: "subtitle-overlay video-subtitles-overlay", "{active_subtitle}" }
                }
                if let Some((msg, icon)) = toast.read().as_ref().cloned() {
                    div { class: "video-player-feedback-toast", role: "status",
                        if let Some(ic) = icon {
                            Icon { name: ic }
                        }
                        span { "{msg}" }
                    }
                }
            }

            div {
                class: if *show_hud.read() || !playing || *subtitles_open.read() { "video-player-hud video-player-hud--visible" } else { "video-player-hud" },
                div { class: "video-player-hud-scrim-top" }
                div { class: "video-player-hud-scrim-bottom" }

                div {
                    class: "video-player-hud-top",
                    onclick: move |e: MouseEvent| e.stop_propagation(),
                    div { class: "video-player-top-left",
                        button {
                            r#type: "button",
                            class: "video-player-btn-icon",
                            aria_label: "Close fullscreen player",
                            title: "Close (Esc)",
                            onclick: move |e: MouseEvent| {
                                e.stop_propagation();
                                app.write().player_expanded = false;
                            },
                            Icon { name: IconName::Close }
                        }
                        div { class: "video-player-meta",
                            span {
                                class: "video-player-category",
                                title: "{media.category_path.as_deref().or(media.category_name.as_deref()).unwrap_or(\"Library\")}",
                                "{media_folder(media)}"
                            }
                            h1 { class: "video-player-title shiny-text", title: "{media.title()}",
                                "{media.title()}"
                            }
                        }
                    }
                    div { class: "video-player-top-right",
                        button {
                            r#type: "button",
                            class: "video-player-btn-icon",
                            aria_label: "Stop playback",
                            title: "Stop playback",
                            onclick: move |e: MouseEvent| {
                                e.stop_propagation();
                                stop_playback(app, engine);
                            },
                            Icon { name: IconName::Stop }
                        }
                    }
                }

                div { class: "video-player-hud-center",
                    button {
                        r#type: "button",
                        class: "video-player-center-btn",
                        aria_label: if playing { "Pause" } else { "Play" },
                        title: if playing { "Pause (Space)" } else { "Play (Space)" },
                        onclick: move |e: MouseEvent| {
                            e.stop_propagation();
                            toggle_playback(app, engine);
                            on_activity();
                        },
                        Icon { name: if playing { IconName::Pause } else { IconName::Play } }
                    }
                }

                div {
                    class: "video-player-hud-bottom",
                    onclick: move |e: MouseEvent| e.stop_propagation(),

                    div {
                        class: "video-player-scrubber-wrap",
                        onclick: move |e: MouseEvent| e.stop_propagation(),
                        Slider {
                            min: 0.0,
                            max: max_pos,
                            step: 0.1,
                            value: current_position,
                            aria_label: "Seek slider".to_owned(),
                            class: "video-player-scrubber-slider".to_owned(),
                            onchange: move |pos| {
                                seek(app, engine, pos);
                                on_activity();
                            }
                        }
                    }

                    div { class: "video-player-controls-row",
                        div { class: "video-player-controls-group",
                            button {
                                r#type: "button",
                                class: "video-player-ctrl-btn video-player-ctrl-btn--primary",
                                aria_label: if playing { "Pause" } else { "Play" },
                                title: if playing { "Pause (Space)" } else { "Play (Space)" },
                                onclick: move |e: MouseEvent| {
                                    e.stop_propagation();
                                    toggle_playback(app, engine);
                                    on_activity();
                                },
                                Icon { name: if playing { IconName::Pause } else { IconName::Play } }
                            }
                            button {
                                r#type: "button",
                                class: "video-player-ctrl-btn",
                                aria_label: "Previous",
                                title: "Previous video",
                                disabled: !has_prev,
                                onclick: move |e: MouseEvent| {
                                    e.stop_propagation();
                                    navigate_queue(app, engine, false, false);
                                    on_activity();
                                },
                                Icon { name: IconName::Previous }
                            }
                            button {
                                r#type: "button",
                                class: "video-player-ctrl-btn",
                                aria_label: "Rewind 10 seconds",
                                title: "Rewind 10s (Left Arrow)",
                                onclick: {
                                    let toast = show_feedback_toast;
                                    move |e: MouseEvent| {
                                        e.stop_propagation();
                                        skip_seconds(app, engine, -10.0);
                                        toast("-10s".to_owned(), Some(IconName::RotateCcw));
                                        on_activity();
                                    }
                                },
                                Icon { name: IconName::RotateCcw }
                            }
                            button {
                                r#type: "button",
                                class: "video-player-ctrl-btn",
                                aria_label: "Forward 10 seconds",
                                title: "Forward 10s (Right Arrow)",
                                onclick: {
                                    let toast = show_feedback_toast;
                                    move |e: MouseEvent| {
                                        e.stop_propagation();
                                        skip_seconds(app, engine, 10.0);
                                        toast("+10s".to_owned(), Some(IconName::RotateCw));
                                        on_activity();
                                    }
                                },
                                Icon { name: IconName::RotateCw }
                            }
                            button {
                                r#type: "button",
                                class: "video-player-ctrl-btn",
                                aria_label: "Next",
                                title: "Next video",
                                disabled: !has_next,
                                onclick: move |e: MouseEvent| {
                                    e.stop_propagation();
                                    navigate_queue(app, engine, true, false);
                                    on_activity();
                                },
                                Icon { name: IconName::Next }
                            }
                            div { class: "video-player-volume-group",
                                button {
                                    r#type: "button",
                                    class: "video-player-ctrl-btn",
                                    aria_label: vol_label,
                                    title: "Mute/Unmute (M)",
                                    onclick: {
                                        let toast = show_feedback_toast;
                                        move |e: MouseEvent| {
                                            e.stop_propagation();
                                            toggle_mute(app, engine);
                                            let is_muted = app.read().settings.volume.get() <= 0.0;
                                            toast(
                                                if is_muted { "Muted".to_owned() } else { "Unmuted".to_owned() },
                                                Some(if is_muted { IconName::VolumeMute } else { IconName::Volume }),
                                            );
                                            on_activity();
                                        }
                                    },
                                    Icon { name: vol_icon }
                                }
                                div { class: "video-player-volume-slider-wrap",
                                    VolumeSlider {
                                        class: "video-player-volume-range".to_owned(),
                                        value: vol,
                                        onchange: move |v| {
                                            set_volume(app, engine, v);
                                            on_activity();
                                        }
                                    }
                                }
                            }
                            div { class: "video-player-time-display",
                                span { "{format_duration(Some(current_position))}" }
                                span { class: "opacity-50 mx-1", "/" }
                                span { class: "opacity-75", "{format_duration(Some(current_duration))}" }
                            }
                        }

                        div { class: "video-player-controls-group",
                            if !snapshot.subtitles.is_empty() {
                                button {
                                    r#type: "button",
                                    class: if snapshot.selected_subtitle.is_some() { "video-player-ctrl-btn video-player-ctrl-btn--active" } else { "video-player-ctrl-btn" },
                                    aria_label: "Subtitles & Captions",
                                    title: "Subtitles & Captions",
                                    onclick: move |e: MouseEvent| {
                                        e.stop_propagation();
                                        let mut sub = subtitles_open;
                                        let open = *sub.read();
                                        *sub.write() = !open;
                                        on_activity();
                                    },
                                    Icon { name: IconName::Subtitles }
                                }
                            }
                            QualityPopover {
                                app,
                                quality: playback.quality,
                            }
                            button {
                                r#type: "button",
                                class: if media.liked { "video-player-ctrl-btn video-player-ctrl-btn--active" } else { "video-player-ctrl-btn" },
                                aria_label: if media.liked { "Remove from favorites" } else { "Add to favorites" },
                                title: if media.liked { "Remove from favorites" } else { "Add to favorites" },
                                onclick: {
                                    let liked = !media.liked;
                                    move |e: MouseEvent| {
                                        e.stop_propagation();
                                        set_favorite(app, liked);
                                        on_activity();
                                    }
                                },
                                Icon { name: IconName::Heart }
                            }
                            button {
                                r#type: "button",
                                class: if snapshot.queue_open { "video-player-ctrl-btn video-player-ctrl-btn--active" } else { "video-player-ctrl-btn" },
                                aria_label: "Queue",
                                title: "Queue",
                                onclick: move |e: MouseEvent| {
                                    e.stop_propagation();
                                    let open = app.read().queue_open;
                                    app.write().queue_open = !open;
                                    on_activity();
                                },
                                Icon { name: IconName::List }
                            }
                            button {
                                r#type: "button",
                                class: "video-player-ctrl-btn",
                                aria_label: "Exit fullscreen",
                                title: "Exit fullscreen (Esc)",
                                onclick: move |e: MouseEvent| {
                                    e.stop_propagation();
                                    app.write().player_expanded = false;
                                },
                                Icon { name: IconName::Compress }
                            }
                        }
                    }
                }
            }

            if *subtitles_open.read() && !snapshot.subtitles.is_empty() {
                SubtitlesOverlayMenu {
                    app,
                    engine,
                    onclose: move |_| {
                        let mut sub = subtitles_open;
                        *sub.write() = false;
                    },
                    onselect: {
                        let toast = show_feedback_toast;
                        move |name: Option<String>| {
                            if let Some(n) = name {
                                toast(format!("Subtitles: {n}"), Some(IconName::Subtitles));
                            } else {
                                toast("Subtitles Off".to_owned(), Some(IconName::Subtitles));
                            }
                        }
                    }
                }
            }
        }
    }
}
