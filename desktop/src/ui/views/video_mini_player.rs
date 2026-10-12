use dioxus_native::prelude::*;

use crate::domain::Quality;
use crate::playback::PlaybackEngine;
use crate::ui::kit::{Artwork, Icon, IconName, Slider};
use crate::ui::views::SessionConflictCard;
use crate::ui::views::player_bar::quality_badge;
use crate::ui::{
    NativeApp, PlaybackStatus, artwork_url, format_duration, media_folder, seek, stop_playback,
    toggle_playback,
};

#[component]
pub(crate) fn VideoMiniPlayer(
    mut app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
    video_source_id: u64,
) -> Element {
    let snapshot = app.read();
    let playback = snapshot.coordinator.snapshot();
    let Some(media) = playback.media.as_ref() else {
        return rsx! {};
    };

    let duration = if playback.duration > 0.0 {
        playback.duration
    } else {
        media.duration.unwrap_or(0.0)
    };
    let max_pos = duration.max(playback.position).max(1.0);
    let playing = playback.status == PlaybackStatus::Playing;
    let session_unavailable = playback.session_unavailable;
    let source = artwork_url(&snapshot, media);

    rsx! {
        aside {
            class: "video-mini-player",
            role: "region",
            aria_label: format!("Mini player: {}", media.title()),

            // ── 16:9 Video Preview / Canvas ──
            div {
                class: "video-mini-preview",
                onclick: move |_| {
                    app.write().player_expanded = true;
                },

                // Artwork poster under canvas as fallback / thumbnail
                div { class: "video-mini-poster",
                    Artwork {
                        source,
                        alt: media.title().to_owned(),
                        fallback: "▶".to_owned(),
                        class: "video-mini-thumb".to_owned(),
                    }
                }

                // Live video surface
                canvas {
                    class: "video-mini-canvas",
                    "src": "{video_source_id}",
                }

                div { class: "video-mini-scrim" }

                // Top actions overlay (Expand & Close)
                div {
                    class: "video-mini-top-actions",
                    onclick: move |e: MouseEvent| e.stop_propagation(),
                    button {
                        r#type: "button",
                        class: "video-mini-top-btn",
                        aria_label: "Expand to fullscreen",
                        title: "Expand to fullscreen (F)",
                        onclick: move |e: MouseEvent| {
                            e.stop_propagation();
                            app.write().player_expanded = true;
                        },
                        Icon { name: IconName::Expand }
                    }
                    button {
                        r#type: "button",
                        class: "video-mini-top-btn",
                        aria_label: "Close video player",
                        title: "Close (Esc)",
                        onclick: move |e: MouseEvent| {
                            e.stop_propagation();
                            stop_playback(app, engine);
                        },
                        Icon { name: IconName::Close }
                    }
                }

                // Bottom preview overlay: Timestamp and quality badge
                div {
                    class: "video-mini-bottom-overlay",
                    span { class: "video-mini-time-tag",
                        "{format_duration(Some(playback.position))} / {format_duration(Some(duration))}"
                    }
                    if playback.quality != Quality::Ori {
                        span { class: "video-mini-badge", "{quality_badge(playback.quality)}" }
                    }
                }
            }

            // ── Interactive Scrubber ──
            div {
                class: "video-mini-scrubber-wrap",
                onclick: move |e: MouseEvent| e.stop_propagation(),
                Slider {
                    class: "video-mini-scrubber-slider".to_owned(),
                    min: 0.0,
                    max: max_pos,
                    step: 0.1,
                    value: playback.position,
                    disabled: session_unavailable,
                    onchange: move |val| seek(app, engine, val),
                }
            }

            // ── Bottom Metadata & Control Strip ──
            div { class: "video-mini-meta-strip",
                div {
                    class: "video-mini-info",
                    onclick: move |_| {
                        app.write().player_expanded = true;
                    },
                    title: "{media.title()}",
                    div { class: "video-mini-title", "{media.title()}" }
                    div { class: "video-mini-subtitle",
                        span { class: "video-mini-folder", "{media_folder(media)}" }
                        if duration > 0.0 {
                            span { class: "video-mini-duration", "{format_duration(Some(duration))}" }
                        }
                    }
                }

                div {
                    class: "video-mini-actions",
                    onclick: move |e: MouseEvent| e.stop_propagation(),

                    // Rewind 10s
                    button {
                        r#type: "button",
                        class: "video-mini-btn",
                        aria_label: "Rewind 10 seconds",
                        title: "Rewind 10s",
                        disabled: session_unavailable,
                        onclick: move |e: MouseEvent| {
                            e.stop_propagation();
                            let pos = app.read().coordinator.snapshot().position;
                            seek(app, engine, (pos - 10.0).max(0.0));
                        },
                        Icon { name: IconName::RotateCcw }
                    }

                    // Play/Pause
                    button {
                        r#type: "button",
                        class: "video-mini-play-btn",
                        aria_label: if playing { "Pause" } else { "Play" },
                        title: if playing { "Pause (Space)" } else { "Play (Space)" },
                        disabled: session_unavailable,
                        onclick: move |e: MouseEvent| {
                            e.stop_propagation();
                            toggle_playback(app, engine);
                        },
                        Icon { name: if playing { IconName::Pause } else { IconName::Play } }
                    }

                    // Forward 10s
                    button {
                        r#type: "button",
                        class: "video-mini-btn",
                        aria_label: "Forward 10 seconds",
                        title: "Forward 10s",
                        disabled: session_unavailable,
                        onclick: move |e: MouseEvent| {
                            e.stop_propagation();
                            let pos = app.read().coordinator.snapshot().position;
                            seek(app, engine, (pos + 10.0).min(duration));
                        },
                        Icon { name: IconName::RotateCw }
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
