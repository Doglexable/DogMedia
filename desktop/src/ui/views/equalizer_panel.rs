use dioxus_native::prelude::dioxus_elements::input_data::MouseButton;
use dioxus_native::prelude::*;

use crate::store::EqSettings;

const PRESETS: [(&str, &str); 8] = [
    ("flat", "Flat"),
    ("rock", "Rock"),
    ("pop", "Pop"),
    ("electronic", "Electronic"),
    ("metal", "Metal"),
    ("dialogue", "Dialogue"),
    ("funk", "Funk"),
    ("dreampop", "Dream Pop"),
];

#[component]
fn EqBand(label: &'static str, value: f64, onchange: EventHandler<f64>) -> Element {
    let mut dragging = use_signal(|| false);
    let gain_str = if value > 0.0 {
        format!("+{value:.1}")
    } else {
        format!("{value:.1}")
    };
    let fill_height = value.abs().clamp(0.0, 10.0) * 4.6;
    let fill_style = if value >= 0.0 {
        format!("bottom: 50%; height: {fill_height:.1}%;")
    } else {
        format!("top: 50%; height: {fill_height:.1}%;")
    };
    let thumb_top = 50.0 - value.clamp(-10.0, 10.0) * 4.6;
    let thumb_style = format!("top: {thumb_top:.1}%;");

    rsx! {
        div { class: "eq-band-item",
            strong { class: "eq-band-gain", "{gain_str}" }
            div {
                class: "eq-meter",
                role: "slider",
                tabindex: "0",
                "aria-label": "{label} gain",
                "aria-orientation": "vertical",
                "aria-valuemin": "-10",
                "aria-valuemax": "10",
                "aria-valuenow": "{value}",
                onkeydown: move |event: KeyboardEvent| {
                    let next = match event.key() {
                        Key::ArrowUp | Key::ArrowRight => Some(value + 1.0),
                        Key::ArrowDown | Key::ArrowLeft => Some(value - 1.0),
                        Key::Home => Some(-10.0),
                        Key::End => Some(10.0),
                        _ => None,
                    };
                    if let Some(next) = next {
                        event.stop_propagation();
                        onchange.call(next.clamp(-10.0, 10.0));
                    }
                },
                div { class: "eq-meter-zero" }
                div {
                    class: if value >= 0.0 { "eq-meter-fill positive" } else { "eq-meter-fill negative" },
                    style: "{fill_style}",
                }
                div { class: "eq-meter-thumb", style: "{thumb_style}" }
                div {
                    class: "eq-meter-hit-area",
                    for position in 0..=20 {
                        span {
                            key: "{position}",
                            class: "eq-meter-hit-zone",
                            onmousedown: move |event: MouseEvent| {
                                if event.data().trigger_button() != Some(MouseButton::Primary) {
                                    return;
                                }
                                event.stop_propagation();
                                dragging.set(true);
                                onchange.call(10.0 - position as f64);
                            },
                            onmousemove: move |event: MouseEvent| {
                                if dragging() {
                                    if event.data().held_buttons().contains(MouseButton::Primary) {
                                        onchange.call(10.0 - position as f64);
                                    } else {
                                        dragging.set(false);
                                    }
                                }
                            },
                            onmouseup: move |event: MouseEvent| {
                                event.stop_propagation();
                                if dragging() {
                                    onchange.call(10.0 - position as f64);
                                }
                                dragging.set(false);
                            },
                        }
                    }
                }
            }
            span { class: "eq-band-label", "{label}" }
            div { class: "eq-band-controls",
                button {
                    r#type: "button",
                    class: "eq-step-btn",
                    "aria-label": "Decrease {label} gain",
                    disabled: value <= -10.0,
                    onclick: move |_| onchange.call((value - 1.0).max(-10.0)),
                    "−"
                }
                button {
                    r#type: "button",
                    class: "eq-step-btn",
                    "aria-label": "Increase {label} gain",
                    disabled: value >= 10.0,
                    onclick: move |_| onchange.call((value + 1.0).min(10.0)),
                    "+"
                }
            }
        }
    }
}

#[component]
pub(crate) fn EqualizerPanel(eq: EqSettings, onchange: EventHandler<EqSettings>) -> Element {
    let toggle_eq = eq.clone();

    rsx! {
        div { class: "field",
            div { class: "field-header",
                span { "Audio Equalizer (EQ)" }
                button {
                    class: if eq.enabled { "eq-toggle-btn active" } else { "eq-toggle-btn" },
                    r#type: "button",
                    "aria-pressed": "{eq.enabled}",
                    onclick: move |_| {
                        let mut next = toggle_eq.clone();
                        next.enabled = !next.enabled;
                        onchange.call(next);
                    },
                    if eq.enabled { "Enabled" } else { "Disabled" }
                }
            }
            small { "Configure 10-band audio equalizer applied to all media playback." }
            div { class: "eq-presets-grid",
                for (preset_name, label) in PRESETS {
                    {
                        let is_active = eq.preset.eq_ignore_ascii_case(preset_name);
                        let preset_eq = eq.clone();
                        rsx! {
                            button {
                                key: "{preset_name}",
                                r#type: "button",
                                class: if is_active { "eq-preset-btn active" } else { "eq-preset-btn" },
                                "aria-pressed": "{is_active}",
                                onclick: move |_| {
                                    if let Some(gains) = EqSettings::preset_gains(preset_name) {
                                        let mut next = preset_eq.clone();
                                        next.preset = preset_name.to_owned();
                                        next.gains = gains;
                                        onchange.call(next);
                                    }
                                },
                                "{label}"
                            }
                        }
                    }
                }
            }
            div { class: "eq-graph",
                div { class: "eq-graph-header",
                    span { "10-BAND GRAPHIC EQ" }
                    span { "−10 dB / +10 dB" }
                }
                div { class: "eq-bands-grid",
                    for (index, band_label) in EqSettings::BAND_LABELS.iter().enumerate() {
                        {
                            let band_eq = eq.clone();
                            rsx! {
                                EqBand {
                                    key: "{index}",
                                    label: *band_label,
                                    value: eq.gains[index],
                                    onchange: move |gain: f64| {
                                        let mut next = band_eq.clone();
                                        next.gains[index] = gain;
                                        next.preset = "custom".to_owned();
                                        onchange.call(next);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
