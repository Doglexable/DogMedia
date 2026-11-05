use dioxus_native::prelude::*;

use super::super::*;
use super::player_bar::{quality_badge, quality_description};

#[component]
pub(crate) fn MediaSettingsDialog(
    mut app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
) -> Element {
    let mut tab = use_signal(|| 0_u8);
    let snapshot = app.read();
    let playback = snapshot.coordinator.snapshot();
    let media = playback.media.as_ref();
    let current_quality = playback.quality;
    let current_rate = snapshot.coordinator.rate();
    let timer_remaining = snapshot.coordinator.sleep_timer_remaining();
    let quality_disabled = snapshot.local_mode || playback.session_unavailable;
    let playback_disabled = playback.session_unavailable
        || media.is_some_and(Media::is_photo)
        || matches!(
            playback.status,
            PlaybackStatus::Idle | PlaybackStatus::Loading | PlaybackStatus::Failed
        );
    let is_video = media.is_some_and(Media::is_video);
    let active_tab = *tab.read();

    rsx! {
        div {
            class: "dialog-backdrop media-settings-backdrop",
            role: "presentation",
            onclick: move |_| app.write().media_settings_open = false,
            section {
                class: "settings-dialog media-settings-dialog",
                role: "dialog",
                "aria-modal": "true",
                "aria-label": "Playback Settings",
                tabindex: "0",
                autofocus: true,
                onclick: move |event: MouseEvent| event.stop_propagation(),
                header { class: "media-settings-header",
                    div {
                        p { class: "eyebrow", "PLAYER" }
                        h2 { "Playback Settings" }
                    }
                    IconButton {
                        label: "Close playback settings".to_owned(),
                        icon: IconName::Close,
                        onclick: move |_| app.write().media_settings_open = false,
                    }
                }
                div { class: "media-settings-tabs", role: "tablist",
                    for (index, label) in [(0_u8, "Quality"), (1, "Speed"), (2, "Sleep Timer")] {
                        button {
                            key: "{index}",
                            r#type: "button",
                            class: if active_tab == index { "media-settings-tab active" } else { "media-settings-tab" },
                            role: "tab",
                            "aria-selected": "{active_tab == index}",
                            onclick: move |_| tab.set(index),
                            "{label}"
                        }
                    }
                }
                div { class: "media-settings-content", role: "tabpanel",
                    if active_tab == 0 {
                        p { class: "media-settings-section-title", "STREAM QUALITY" }
                        div { class: "media-settings-quality-list",
                            for quality in [Quality::Ori, Quality::High, Quality::Med, Quality::Low] {
                                if media.is_some_and(|item| item.supports_quality(quality)) {
                                    button {
                                        key: "{quality}",
                                        r#type: "button",
                                        class: if current_quality == quality { "media-settings-quality active" } else { "media-settings-quality" },
                                        disabled: quality_disabled,
                                        "aria-pressed": "{current_quality == quality}",
                                        onclick: move |_| change_quality(app, engine, quality),
                                        span { class: "media-settings-quality-copy",
                                            strong { "{quality}" }
                                            small { "{quality_description(quality, is_video)}" }
                                        }
                                        span { class: "media-settings-quality-badge", "{quality_badge(quality)}" }
                                    }
                                }
                            }
                        }
                        if quality_disabled {
                            p { class: "media-settings-hint", "Stream quality is unavailable for this playback." }
                        }
                    } else if active_tab == 1 {
                        p { class: "media-settings-section-title", "PLAYBACK SPEED" }
                        div { class: "media-settings-grid",
                            for rate in [0.5_f64, 0.75, 1.0, 1.25, 1.5, 2.0] {
                                button {
                                    key: "{rate}",
                                    r#type: "button",
                                    class: if (current_rate - rate).abs() < 0.001 { "media-settings-pill active" } else { "media-settings-pill" },
                                    disabled: playback_disabled,
                                    "aria-pressed": "{(current_rate - rate).abs() < 0.001}",
                                    onclick: move |_| change_playback_rate(app, engine, rate),
                                    if rate == 1.0 { "1x · Normal" } else { "{rate}x" }
                                }
                            }
                        }
                    } else {
                        p { class: "media-settings-section-title", "SLEEP TIMER" }
                        if let Some(remaining) = timer_remaining {
                            div { class: "media-settings-countdown",
                                small { "TIME REMAINING" }
                                strong { "{remaining / 60}:{remaining % 60:02}" }
                            }
                        }
                        div { class: "media-settings-grid",
                            for minutes in [15_u32, 30, 45, 60] {
                                button {
                                    key: "{minutes}",
                                    r#type: "button",
                                    class: "media-settings-pill",
                                    disabled: playback.session_unavailable,
                                    onclick: move |_| app.write().coordinator.set_sleep_timer(Some(minutes)),
                                    "{minutes}m"
                                }
                            }
                        }
                        button {
                            r#type: "button",
                            class: if timer_remaining.is_none() { "media-settings-off active" } else { "media-settings-off" },
                            onclick: move |_| app.write().coordinator.set_sleep_timer(None),
                            "Turn off timer"
                        }
                    }
                }
            }
        }
    }
}
