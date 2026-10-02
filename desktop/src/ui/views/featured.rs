use dioxus_native::prelude::*;

use super::super::*;

#[component]
pub(crate) fn Featured(
    app: Signal<NativeApp>,
    engine: Signal<Option<PlaybackEngine>>,
    media: Media,
    #[props(default)] on_menu: Option<EventHandler<(Media, f64, f64)>>,
) -> Element {
    let snapshot = app.read().clone();
    let source = artwork_url(&snapshot, &media);
    let category = media
        .category_path
        .as_deref()
        .or(media.category_name.as_deref())
        .unwrap_or("Library");
    let description = media
        .description
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    let fallback = if media.is_video() {
        "▶"
    } else if media.is_photo() {
        "▧"
    } else {
        "♪"
    };

    rsx! {
        section { class: "featured-card",
            div { class: "featured-copy",
                p { class: "eyebrow", "Featured signal · {media_kind(&media)}" }
                h1 { "{media.title()}" }
                div { class: "featured-meta",
                    span { "{category}" }
                    span { "{format_duration(media.duration)}" }
                }
                if let Some(description) = description {
                    p { class: "featured-description", "{description}" }
                }
                div { class: "featured-actions",
                    Button {
                        label: "Play".to_owned(),
                        icon: IconName::Play,
                        class: "primary".to_owned(),
                        onclick: { let media = media.clone(); move |_| play_media(app, engine, media.clone(), true) }
                    }
                    Button {
                        label: "Play next".to_owned(),
                        icon: IconName::Next,
                        class: "secondary".to_owned(),
                        onclick: { let id = media.id; move |_| add_media_to_queue(app, id, true) }
                    }
                    Button {
                        label: "Queue".to_owned(),
                        icon: IconName::ListPlus,
                        class: "secondary".to_owned(),
                        onclick: { let id = media.id; move |_| add_media_to_queue(app, id, false) }
                    }
                    if let Some(on_menu) = on_menu {
                        button {
                            class: "icon-button more-menu",
                            r#type: "button",
                            title: "More options",
                            "aria-label": "More options for {media.title()}",
                            onclick: {
                                let media = media.clone();
                                move |event: MouseEvent| {
                                    event.stop_propagation();
                                    let point = event.data().client_coordinates();
                                    on_menu.call((media.clone(), point.x, point.y));
                                }
                            },
                            Icon { name: IconName::More }
                        }
                    }
                }
            }
            div { class: "featured-art-wrap",
                Artwork {
                    source,
                    alt: media.title().to_owned(),
                    fallback: fallback.to_owned(),
                    class: "featured-art".to_owned()
                }
            }
        }
    }
}
