use dioxus_native::prelude::*;
use std::sync::Arc;

use crate::store::ColorScheme;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IconName {
    Check,
    ChevronDown,
    ChevronRight,
    Clock,
    Close,
    Compress,
    Expand,
    Folder,
    Grid,
    GripVertical,
    Heart,
    Library,
    List,
    ListPlus,
    Lyrics,
    Monitor,
    Moon,
    More,
    Next,
    Pause,
    Play,
    Previous,
    Refresh,
    Repeat,
    RepeatOne,
    RotateCcw,
    RotateCw,
    Search,
    Settings,
    Shuffle,
    Signal,
    Stop,
    Subtitles,
    Sun,
    Volume,
    VolumeLow,
    VolumeMute,
}

#[component]
pub fn Icon(name: IconName, #[props(default)] class: String) -> Element {
    let class = if class.is_empty() {
        "ui-icon".to_owned()
    } else {
        format!("ui-icon {class}")
    };

    let shape = match name {
        IconName::Check => rsx! { path { d: "M20 6 9 17l-5-5" } },
        IconName::ChevronDown => rsx! { path { d: "m6 9 6 6 6-6" } },
        IconName::ChevronRight => rsx! { path { d: "m9 18 6-6-6-6" } },
        IconName::Clock => rsx! {
            circle { cx: "12", cy: "12", r: "9" }
            path { d: "M12 7v5l3 2" }
        },
        IconName::Close => rsx! { path { d: "M18 6 6 18M6 6l12 12" } },
        IconName::Compress => rsx! {
            path { d: "M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" }
        },
        IconName::Expand => rsx! { path { d: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" } },
        IconName::Folder => {
            rsx! { path { d: "M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z" } }
        }
        IconName::Grid => rsx! {
            rect { x: "3", y: "3", width: "7", height: "7", rx: "1" }
            rect { x: "14", y: "3", width: "7", height: "7", rx: "1" }
            rect { x: "3", y: "14", width: "7", height: "7", rx: "1" }
            rect { x: "14", y: "14", width: "7", height: "7", rx: "1" }
        },
        IconName::GripVertical => rsx! {
            circle { cx: "9", cy: "12", r: "1.2", fill: "currentColor" }
            circle { cx: "9", cy: "5", r: "1.2", fill: "currentColor" }
            circle { cx: "9", cy: "19", r: "1.2", fill: "currentColor" }
            circle { cx: "15", cy: "12", r: "1.2", fill: "currentColor" }
            circle { cx: "15", cy: "5", r: "1.2", fill: "currentColor" }
            circle { cx: "15", cy: "19", r: "1.2", fill: "currentColor" }
        },
        IconName::Heart => {
            rsx! { path { d: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" } }
        }
        IconName::Library => rsx! {
            path { d: "M4 19.5V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14.5" }
            path { d: "M4 16h16M8 7h8M8 11h5" }
        },
        IconName::List => rsx! {
            path { d: "M8 6h13M8 12h13M8 18h13" }
            path { d: "M3 6h.01M3 12h.01M3 18h.01" }
        },
        IconName::ListPlus => rsx! {
            path { d: "M9 6h12M9 12h12M9 18h6M3 6h.01M3 12h.01M3 18h.01M19 16v6M16 19h6" }
        },
        IconName::Lyrics => rsx! {
            path { d: "M4 8h6v5l-3 4H4l3-4H4V8Zm9 0h6v5l-3 4h-3l3-4h-3V8Z", fill: "currentColor", stroke: "none" }
        },
        IconName::Monitor => rsx! {
            rect { x: "3", y: "4", width: "18", height: "13", rx: "2" }
            path { d: "M8 21h8M12 17v4" }
        },
        IconName::Moon => rsx! { path { d: "M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" } },
        IconName::More => rsx! {
            circle { cx: "5", cy: "12", r: "1" }
            circle { cx: "12", cy: "12", r: "1" }
            circle { cx: "19", cy: "12", r: "1" }
        },
        IconName::Next => rsx! { path { d: "m5 4 10 8-10 8V4ZM19 5v14" } },
        IconName::Pause => rsx! {
            rect { x: "6", y: "4", width: "4", height: "16", rx: "1", fill: "currentColor" }
            rect { x: "14", y: "4", width: "4", height: "16", rx: "1", fill: "currentColor" }
        },
        IconName::Play => rsx! { path { d: "m7 4 13 8-13 8V4Z", fill: "currentColor" } },
        IconName::Previous => rsx! { path { d: "m19 4-10 8 10 8V4ZM5 5v14" } },
        IconName::Refresh => {
            rsx! { path { d: "M20 7h-5V2M4 17h5v5M19 12a7 7 0 0 0-12-5l-3 3M5 12a7 7 0 0 0 12 5l3-3" } }
        }
        IconName::Repeat => rsx! {
            path { d: "m17 2 4 4-4 4" }
            path { d: "M3 11v-1a4 4 0 0 1 4-4h14" }
            path { d: "m7 22-4-4 4-4" }
            path { d: "M21 13v1a4 4 0 0 1-4 4H3" }
        },
        IconName::RepeatOne => rsx! {
            path { d: "m17 2 4 4-4 4" }
            path { d: "M3 11v-1a4 4 0 0 1 4-4h14" }
            path { d: "m7 22-4-4 4-4" }
            path { d: "M21 13v1a4 4 0 0 1-4 4H3" }
            path { d: "M11 10h1v4" }
        },
        IconName::RotateCcw => rsx! {
            path { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" }
            path { d: "M3 3v5h5" }
        },
        IconName::RotateCw => rsx! {
            path { d: "M21 12a9 9 0 1 1-9-9c2.52 0 4.85.83 6.74 2.74L21 8" }
            path { d: "M21 3v5h-5" }
        },
        IconName::Search => rsx! {
            circle { cx: "11", cy: "11", r: "7" }
            path { d: "m20 20-4-4" }
        },
        IconName::Settings => rsx! {
            circle { cx: "12", cy: "12", r: "3" }
            path { d: "M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" }
        },
        IconName::Shuffle => rsx! {
            path { d: "M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.6-8.6c.8-1.1 2-1.7 3.3-1.7H22" }
            path { d: "m18 2 4 4-4 4" }
            path { d: "M2 6h1.4c1.3 0 2.5.6 3.3 1.7l2 2.6" }
            path { d: "m14.7 14.7 1.6 2.1c.8 1.1 2 1.7 3.3 1.7H22" }
            path { d: "m18 14 4 4-4 4" }
        },
        IconName::Signal => rsx! {
            path { d: "M2 20h.01" }
            path { d: "M7 20v-4" }
            path { d: "M12 20v-8" }
            path { d: "M17 20v-12" }
            path { d: "M22 20V4" }
        },
        IconName::Stop => {
            rsx! { rect { x: "5", y: "5", width: "14", height: "14", rx: "2", fill: "currentColor" } }
        }
        IconName::Subtitles => rsx! {
            rect { x: "2", y: "4", width: "20", height: "16", rx: "2" }
            path { d: "M7 15h4M15 15h2M7 11h2M13 11h4" }
        },
        IconName::Sun => rsx! {
            circle { cx: "12", cy: "12", r: "4" }
            path { d: "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" }
        },
        IconName::Volume => rsx! {
            path { d: "M11 5 6 9H2v6h4l5 4V5Z" }
            path { d: "M15.54 8.46a5 5 0 0 1 0 7.07" }
            path { d: "M19.07 4.93a10 10 0 0 1 0 14.14" }
        },
        IconName::VolumeLow => rsx! {
            path { d: "M11 5 6 9H2v6h4l5 4V5Z" }
            path { d: "M15.54 8.46a5 5 0 0 1 0 7.07" }
        },
        IconName::VolumeMute => rsx! {
            path { d: "M11 5 6 9H2v6h4l5 4V5Z" }
            path { d: "m22 9-6 6M16 9l6 6" }
        },
    };

    rsx! {
        svg {
            class,
            view_box: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            stroke_width: "1.8",
            stroke_linecap: "round",
            stroke_linejoin: "round",
            "aria-hidden": "true",
            {shape}
        }
    }
}

#[component]
pub fn Button(
    label: String,
    #[props(default)] icon: Option<IconName>,
    #[props(default)] class: String,
    #[props(default)] disabled: bool,
    onclick: EventHandler<MouseEvent>,
) -> Element {
    let button_class = if icon.is_some() {
        if class.is_empty() {
            "button has-icon".to_owned()
        } else {
            format!("button has-icon {class}")
        }
    } else if class.is_empty() {
        "button".to_owned()
    } else {
        format!("button {class}")
    };

    rsx! {
        button {
            class: "{button_class}",
            r#type: "button",
            disabled,
            "aria-label": "{label}",
            onclick: move |event| onclick.call(event),
            {
                match icon {
                    Some(icon) => rsx! {
                        Icon { name: icon, class: "button-icon".to_owned() }
                        span { class: "button-label", "{label}" }
                    },
                    None => rsx! {
                        span { class: "button-label", "{label}" }
                    },
                }
            }
        }
    }
}

#[component]
pub fn IconButton(
    label: String,
    icon: IconName,
    #[props(default)] class: String,
    #[props(default)] disabled: bool,
    onclick: EventHandler<MouseEvent>,
) -> Element {
    rsx! {
        button {
            class: "icon-button {class}",
            r#type: "button",
            disabled,
            title: "{label}",
            "aria-label": "{label}",
            onclick: move |event| onclick.call(event),
            Icon { name: icon }
        }
    }
}

#[component]
pub fn Chip(label: String, selected: bool, onclick: EventHandler<MouseEvent>) -> Element {
    rsx! {
        button {
            class: if selected { "chip active" } else { "chip" },
            r#type: "button",
            "aria-pressed": selected,
            onclick: move |event| onclick.call(event),
            span { class: "chip-label", "{label}" }
        }
    }
}

#[component]
pub fn ThemeToggle(value: ColorScheme, onchange: EventHandler<ColorScheme>) -> Element {
    rsx! {
        div { class: "theme-toggle", role: "radiogroup", "aria-label": "Appearance",
            button {
                class: if value == ColorScheme::System { "theme-toggle-option active" } else { "theme-toggle-option" },
                r#type: "button",
                role: "radio",
                "aria-checked": value == ColorScheme::System,
                title: "Use system appearance",
                onclick: move |_| onchange.call(ColorScheme::System),
                Icon { name: IconName::Monitor, class: "theme-toggle-icon".to_owned() }
                span { "System" }
            }
            button {
                class: if value == ColorScheme::Light { "theme-toggle-option active" } else { "theme-toggle-option" },
                r#type: "button",
                role: "radio",
                "aria-checked": value == ColorScheme::Light,
                title: "Use light appearance",
                onclick: move |_| onchange.call(ColorScheme::Light),
                Icon { name: IconName::Sun, class: "theme-toggle-icon".to_owned() }
                span { "Light" }
            }
            button {
                class: if value == ColorScheme::Dark { "theme-toggle-option active" } else { "theme-toggle-option" },
                r#type: "button",
                role: "radio",
                "aria-checked": value == ColorScheme::Dark,
                title: "Use dark appearance",
                onclick: move |_| onchange.call(ColorScheme::Dark),
                Icon { name: IconName::Moon, class: "theme-toggle-icon".to_owned() }
                span { "Dark" }
            }
        }
    }
}

#[component]
pub fn Artwork(
    source: Option<Arc<String>>,
    alt: String,
    fallback: String,
    #[props(default)] class: String,
) -> Element {
    rsx! {
        div { class: "artwork {class}",
            if let Some(source) = source {
                img { src: "{source}", alt: "{alt}", draggable: "false" }
            } else {
                span { class: "artwork-fallback", "aria-hidden": "true", "{fallback}" }
            }
        }
    }
}

#[component]
pub fn StatusBadge(label: String, class: String) -> Element {
    rsx! {
        span { class: "status-badge {class}",
            span { class: "status-dot", "aria-hidden": "true" }
            "{label}"
        }
    }
}

#[component]
pub fn Notice(message: String, onclose: EventHandler<MouseEvent>) -> Element {
    rsx! {
        div { class: "notice", role: "status",
            span { "{message}" }
            button {
                class: "notice-close",
                r#type: "button",
                title: "Dismiss",
                "aria-label": "Dismiss message",
                onclick: move |event| onclose.call(event),
                Icon { name: IconName::Close }
            }
        }
    }
}

#[component]
pub fn Skeleton() -> Element {
    rsx! {
        div { class: "skeleton-stack", role: "status", "aria-label": "Loading",
            div { class: "skeleton skeleton-block" }
            div { class: "skeleton skeleton-block skeleton-short" }
            div { class: "skeleton skeleton-block" }
        }
    }
}

#[component]
pub fn MediaListSkeleton(rows: usize) -> Element {
    rsx! {
        div { class: "media-skeleton-list", role: "status", "aria-label": "Loading media",
            for row in 0..rows {
                div { class: "media-skeleton-row", key: "{row}", "aria-hidden": "true",
                    div { class: "media-skeleton-row-main",
                        span { class: "skeleton skeleton-index" }
                        span { class: "skeleton-title-cell",
                            span { class: "skeleton skeleton-title" }
                            span { class: "skeleton skeleton-subtitle" }
                        }
                        span { class: "skeleton skeleton-folder" }
                        span { class: "skeleton skeleton-added" }
                        span { class: "skeleton skeleton-duration" }
                    }
                    span { class: "skeleton-actions",
                        span { class: "skeleton skeleton-action" }
                    }
                }
            }
        }
    }
}

#[component]
pub fn Input(
    value: String,
    placeholder: String,
    input_type: String,
    oninput: EventHandler<FormEvent>,
    #[props(default)] onkeydown: Option<EventHandler<KeyboardEvent>>,
) -> Element {
    rsx! {
        input {
            class: "input",
            r#type: "{input_type}",
            value,
            placeholder,
            oninput: move |event| oninput.call(event),
            onkeydown: move |event: KeyboardEvent| {
                event.stop_propagation();
                if let Some(handler) = onkeydown.as_ref() { handler.call(event); }
            }
        }
    }
}

#[component]
pub fn Select(
    value: String,
    onchange: EventHandler<FormEvent>,
    #[props(default)] class: String,
    children: Element,
) -> Element {
    let class_name = if class.is_empty() {
        "select".to_owned()
    } else {
        format!("select {class}")
    };
    rsx! {
        select {
            class: "{class_name}",
            value,
            onchange: move |event| onchange.call(event),
            {children}
        }
    }
}

pub(super) fn slider_value_at(
    index: usize,
    divisions: usize,
    min: f64,
    max: f64,
    step: f64,
) -> f64 {
    let range = (max - min).max(f64::EPSILON);
    let divisions = divisions.max(1);
    let raw = min + range * (index.min(divisions) as f64 / divisions as f64);
    let value = if step > 0.0 {
        min + ((raw - min) / step).round() * step
    } else {
        raw
    };
    value.clamp(min, max)
}

#[component]
pub fn Slider(
    #[props(into, optional)] class: Option<String>,
    #[props(default = 0.0)] min: f64,
    #[props(default = 100.0)] max: f64,
    #[props(default = 1.0)] step: f64,
    #[props(default = 50.0)] value: f64,
    #[props(default = 100)] hit_divisions: usize,
    #[props(optional)] disabled: bool,
    #[props(into, optional)] aria_label: Option<String>,
    #[props(optional)] onchange: Option<EventHandler<f64>>,
) -> Element {
    let base_class = if disabled {
        "slider slider-disabled"
    } else {
        "slider"
    };
    let merged = match &class {
        Some(c) if !c.is_empty() => format!("{base_class} {c}"),
        _ => base_class.to_string(),
    };
    let range = (max - min).max(f64::EPSILON);
    let percentage = ((value - min) / range * 100.0).clamp(0.0, 100.0);
    let fill_style = format!("width: {percentage:.2}%;");
    let thumb_style = format!("left: {percentage:.2}%;");
    let mut dragging = use_signal(|| false);
    let commit = move |index: usize| {
        if disabled {
            return;
        }
        if let Some(handler) = &onchange {
            handler.call(slider_value_at(index, hit_divisions, min, max, step));
        }
    };

    rsx! {
        div {
            "data-name": "Slider",
            class: "{merged}",
            role: "slider",
            tabindex: if disabled { "-1" } else { "0" },
            "aria-label": aria_label.as_deref().unwrap_or("Slider"),
            "aria-valuemin": "{min}",
            "aria-valuemax": "{max}",
            "aria-valuenow": "{value}",
            "aria-disabled": "{disabled}",
            onkeydown: move |event: KeyboardEvent| {
                if disabled {
                    return;
                }
                let next = match event.key() {
                    Key::ArrowLeft | Key::ArrowDown => Some(value - step),
                    Key::ArrowRight | Key::ArrowUp => Some(value + step),
                    Key::Home => Some(min),
                    Key::End => Some(max),
                    _ => None,
                };
                if let (Some(next), Some(handler)) = (next, &onchange) {
                    handler.call(next.clamp(min, max));
                }
            },
            div {
                class: "slider-hit-area",
                onmouseleave: move |_| dragging.set(false),
                for index in 0..=hit_divisions {
                    span {
                        class: "slider-hit-zone",
                        onmousedown: move |event: MouseEvent| {
                            event.stop_propagation();
                            dragging.set(true);
                            commit(index);
                        },
                        onmouseenter: move |_| {
                            if dragging() {
                                commit(index);
                            }
                        },
                        onmouseup: move |event: MouseEvent| {
                            event.stop_propagation();
                            if dragging() {
                                commit(index);
                            }
                            dragging.set(false);
                        },
                    }
                }
            }
            div { class: "slider-visual", "aria-hidden": "true",
                div { class: "slider-track",
                    div { class: "slider-fill", style: "{fill_style}" }
                }
                div { class: "slider-thumb", style: "{thumb_style}" }
            }
        }
    }
}

#[component]
pub fn MusicProgress(
    position: f64,
    duration: f64,
    onseek: EventHandler<f64>,
    #[props(default = String::new())] class: String,
    #[props(default = false)] disabled: bool,
) -> Element {
    let max = duration.max(1.0);
    let mut value = use_signal(|| position.min(max));
    use_effect(use_reactive(
        (&position, &duration),
        move |(position, duration)| {
            value.set(position.min(duration.max(1.0)));
        },
    ));
    let current = value().min(max);

    rsx! {
        div { class: "music-progress-wrap {class}",
            span { class: "progress-time", "{super::format_duration(Some(current))}" }
            Slider {
                min: 0.0,
                max,
                step: 0.1,
                value: current,
                aria_label: "Playback position".to_owned(),
                class: "music-progress-slider".to_string(),
                disabled,
                onchange: move |position: f64| {
                    value.set(position);
                    onseek.call(position);
                },
            }
            span { class: "progress-time progress-duration", "{super::format_duration(Some(duration))}" }
        }
    }
}

#[component]
pub fn VolumeSlider(
    value: f64,
    onchange: EventHandler<f64>,
    #[props(default = String::new())] class: String,
) -> Element {
    let initial = (value * 100.0).clamp(0.0, 100.0);
    let mut slider_value = use_signal(|| initial);
    use_effect(use_reactive((&value,), move |(value,)| {
        slider_value.set((value * 100.0).clamp(0.0, 100.0));
    }));

    rsx! {
        Slider {
            class,
            min: 0.0,
            max: 100.0,
            step: 1.0,
            hit_divisions: 40,
            value: slider_value(),
            aria_label: "Volume",
            onchange: move |next: f64| {
                let next = next.clamp(0.0, 100.0);
                slider_value.set(next);
                onchange.call(next / 100.0);
            }
        }
    }
}

#[derive(Clone, Copy)]
struct PopoverContext {
    open: Signal<bool>,
}

#[component]
pub fn Popover(#[props(default = String::new())] class: String, children: Element) -> Element {
    let open = use_signal(|| false);
    let is_open = *open.read();
    provide_context(PopoverContext { open });

    rsx! {
        div {
            "data-name": "Popover",
            class: if is_open { "popover-root popover-open {class}" } else { "popover-root {class}" },
            {children}
        }
    }
}

#[component]
pub fn PopoverTrigger(
    #[props(default = String::new())] class: String,
    #[props(default = false)] disabled: bool,
    #[props(default = String::new())] aria_label: String,
    #[props(optional)] ondoubleclick: Option<EventHandler<MouseEvent>>,
    children: Element,
) -> Element {
    let mut ctx = use_context::<PopoverContext>();
    let is_open = *ctx.open.read();

    rsx! {
        button {
            "data-name": "PopoverTrigger",
            r#type: "button",
            class: "popover-trigger {class}",
            disabled,
            "aria-expanded": "{is_open}",
            "aria-haspopup": "dialog",
            "aria-label": if !aria_label.is_empty() { Some(aria_label) } else { None },
            onclick: move |event: MouseEvent| {
                event.stop_propagation();
                let current = *ctx.open.read();
                ctx.open.set(!current);
            },
            ondoubleclick: move |event: MouseEvent| {
                if let Some(handler) = &ondoubleclick {
                    handler.call(event);
                }
            },
            {children}
        }
    }
}

#[component]
pub fn PopoverContent(
    #[props(default = String::new())] class: String,
    children: Element,
) -> Element {
    let ctx = use_context::<PopoverContext>();
    let is_open = *ctx.open.read();

    if !is_open {
        return rsx! {};
    }

    rsx! {
        div {
            class: "popover-backdrop",
            onclick: {
                let mut open = ctx.open;
                move |event: MouseEvent| {
                    event.stop_propagation();
                    open.set(false);
                }
            },
        }
        div {
            "data-name": "PopoverContent",
            class: "popover-content side-top align-center {class}",
            role: "dialog",
            onclick: move |event: MouseEvent| event.stop_propagation(),
            {children}
        }
    }
}

#[component]
pub fn Draggable(#[props(into, optional)] class: Option<String>, children: Element) -> Element {
    let base_class = "draggable-root flex flex-col gap-1 w-full";
    let merged = match &class {
        Some(c) if !c.is_empty() => format!("{base_class} {c}"),
        _ => base_class.to_string(),
    };
    rsx! {
        div {
            "data-name": "Draggable",
            class: "{merged}",
            {children}
        }
    }
}

#[component]
pub fn DraggableZone(#[props(into, optional)] class: Option<String>, children: Element) -> Element {
    let base_class = "draggable-zone draggable__container flex flex-col gap-1 w-full";
    let merged = match &class {
        Some(c) if !c.is_empty() => format!("{base_class} {c}"),
        _ => base_class.to_string(),
    };
    rsx! {
        div {
            "data-name": "DraggableZone",
            class: "{merged}",
            {children}
        }
    }
}

#[component]
pub fn DraggableItem(
    #[props(into, optional)] class: Option<String>,
    #[props(default = true)] draggable: bool,
    #[props(default = false)] dragging: bool,
    #[props(default = false)] drag_over: bool,
    #[props(optional)] ondragstart: Option<EventHandler<DragEvent>>,
    #[props(optional)] ondragover: Option<EventHandler<DragEvent>>,
    #[props(optional)] ondragenter: Option<EventHandler<DragEvent>>,
    #[props(optional)] ondragleave: Option<EventHandler<DragEvent>>,
    #[props(optional)] ondrop: Option<EventHandler<DragEvent>>,
    #[props(optional)] ondragend: Option<EventHandler<DragEvent>>,
    #[props(optional)] onmouseenter: Option<EventHandler<MouseEvent>>,
    #[props(optional)] onmouseup: Option<EventHandler<MouseEvent>>,
    children: Element,
) -> Element {
    let mut base_class = "draggable draggable-item".to_string();
    if dragging {
        base_class.push_str(" dragging opacity-50");
    }
    if drag_over {
        base_class.push_str(" drag-over");
    }
    let merged = match &class {
        Some(c) if !c.is_empty() => format!("{base_class} {c}"),
        _ => base_class,
    };

    rsx! {
        div {
            "data-name": "DraggableItem",
            class: "{merged}",
            draggable: if draggable { "true" } else { "false" },
            tabindex: "0",
            ondragstart: move |e| if let Some(h) = &ondragstart { h.call(e); },
            ondragover: move |e| if let Some(h) = &ondragover { h.call(e); },
            ondragenter: move |e| if let Some(h) = &ondragenter { h.call(e); },
            ondragleave: move |e| if let Some(h) = &ondragleave { h.call(e); },
            ondrop: move |e| if let Some(h) = &ondrop { h.call(e); },
            ondragend: move |e| if let Some(h) = &ondragend { h.call(e); },
            onmouseenter: move |e| if let Some(h) = &onmouseenter { h.call(e); },
            onmouseup: move |e| if let Some(h) = &onmouseup { h.call(e); },
            {children}
        }
    }
}
