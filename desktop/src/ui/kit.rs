use dioxus_native::prelude::*;

use crate::store::ColorScheme;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IconName {
    ChevronDown,
    Clock,
    Close,
    Expand,
    Folder,
    Grid,
    Heart,
    Library,
    List,
    ListPlus,
    Monitor,
    Moon,
    More,
    Next,
    Pause,
    Play,
    Previous,
    Refresh,
    Search,
    Settings,
    Stop,
    Sun,
}

#[component]
pub fn Icon(name: IconName, #[props(default)] class: String) -> Element {
    let class = if class.is_empty() {
        "ui-icon".to_owned()
    } else {
        format!("ui-icon {class}")
    };

    let shape = match name {
        IconName::ChevronDown => rsx! { path { d: "m6 9 6 6 6-6" } },
        IconName::Clock => rsx! {
            circle { cx: "12", cy: "12", r: "9" }
            path { d: "M12 7v5l3 2" }
        },
        IconName::Close => rsx! { path { d: "M18 6 6 18M6 6l12 12" } },
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
            rect { x: "6", y: "4", width: "4", height: "16", rx: "1" }
            rect { x: "14", y: "4", width: "4", height: "16", rx: "1" }
        },
        IconName::Play => rsx! { path { d: "m7 4 13 8-13 8V4Z" } },
        IconName::Previous => rsx! { path { d: "m19 4-10 8 10 8V4ZM5 5v14" } },
        IconName::Refresh => {
            rsx! { path { d: "M20 7h-5V2M4 17h5v5M19 12a7 7 0 0 0-12-5l-3 3M5 12a7 7 0 0 0 12 5l3-3" } }
        }
        IconName::Search => rsx! {
            circle { cx: "11", cy: "11", r: "7" }
            path { d: "m20 20-4-4" }
        },
        IconName::Settings => rsx! {
            circle { cx: "12", cy: "12", r: "3" }
            path { d: "M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" }
        },
        IconName::Stop => rsx! { rect { x: "5", y: "5", width: "14", height: "14", rx: "2" } },
        IconName::Sun => rsx! {
            circle { cx: "12", cy: "12", r: "4" }
            path { d: "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" }
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
    rsx! {
        button {
            class: "button {class}",
            r#type: "button",
            disabled,
            "aria-label": "{label}",
            onclick: move |event| onclick.call(event),
            if let Some(icon) = icon {
                Icon { name: icon, class: "button-icon".to_owned() }
            }
            span { class: "button-label", "{label}" }
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
pub fn Card(#[props(default)] class: String, children: Element) -> Element {
    rsx! { section { class: "card {class}", {children} } }
}

#[component]
pub fn Artwork(
    source: Option<String>,
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
            onkeydown: move |event| if let Some(handler) = onkeydown.as_ref() { handler.call(event); }
        }
    }
}

#[component]
pub fn Select(value: String, onchange: EventHandler<FormEvent>, children: Element) -> Element {
    rsx! {
        select {
            class: "select",
            value,
            onchange: move |event| onchange.call(event),
            {children}
        }
    }
}
