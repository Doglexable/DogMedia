use base64::Engine as _;
use dioxus_native::prelude::*;

use super::super::*;
use crate::api::PaletteColor;
use crate::domain::LyricSegment;
use crate::ui::lyrics_card::{DEFAULT_BACKGROUND, render_lyrics_card, text_color};

const MAX_LINES: usize = 5;

fn share_window(anchor: usize, count: usize) -> std::ops::Range<usize> {
    let size = count.min(MAX_LINES);
    let start = anchor
        .saturating_sub(size / 2)
        .min(count.saturating_sub(size));
    start..start + size
}

fn update_selection(current: Option<(usize, usize)>, index: usize) -> Option<(usize, usize)> {
    let Some((start, end)) = current else {
        return Some((index, index));
    };
    if index == start && index == end {
        None
    } else if index == start {
        Some((start + 1, end))
    } else if index == end {
        Some((start, end - 1))
    } else if index + 1 == start {
        (end - index < MAX_LINES)
            .then_some((index, end))
            .or(current)
    } else if index == end + 1 {
        (index - start < MAX_LINES)
            .then_some((start, index))
            .or(current)
    } else {
        Some((index, index))
    }
}

fn filename(title: &str) -> String {
    let mut slug = String::new();
    for ch in title.chars().flat_map(char::to_lowercase) {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
        } else if !slug.is_empty() && !slug.ends_with('-') {
            slug.push('-');
        }
        if slug.len() >= 60 {
            break;
        }
    }
    let slug = slug.trim_matches('-');
    format!(
        "{}-lyrics.png",
        if slug.is_empty() { "lyrics" } else { slug }
    )
}

fn cached_artwork_bytes(source: &str) -> Option<Vec<u8>> {
    if let Some((header, encoded)) = source.split_once(',') {
        if header.starts_with("data:image/") && header.ends_with(";base64") {
            return base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .ok();
        }
    }
    let path = url::Url::parse(source).ok()?.to_file_path().ok()?;
    std::fs::read(path).ok()
}

#[component]
pub(crate) fn LyricsShareDialog(
    app: Signal<NativeApp>,
    mut open: Signal<bool>,
    media: Media,
    segments: Vec<LyricSegment>,
    position: f64,
    preview_artwork: Option<String>,
) -> Element {
    let shareable: Vec<_> = segments
        .into_iter()
        .filter(|segment| !segment.text.trim().is_empty())
        .collect();
    let initial_anchor = shareable
        .iter()
        .rposition(|segment| segment.start <= position)
        .unwrap_or(0);
    let anchor_signal = use_signal(|| initial_anchor);
    let anchor = anchor_signal();
    let candidate = share_window(anchor, shareable.len());
    let mut selection = use_signal(|| (!shareable.is_empty()).then_some((anchor, anchor)));
    let mut palette = use_signal(Vec::<PaletteColor>::new);
    let mut palette_index = use_signal(|| 0usize);
    let fallback_artwork = preview_artwork.as_deref().and_then(cached_artwork_bytes);
    let mut artwork_bytes = use_signal(|| fallback_artwork);
    let mut artwork_src = use_signal(|| preview_artwork);
    let mut loading = use_signal(|| !app.read().local_mode);
    let mut saving = use_signal(|| false);
    let mut error = use_signal(|| None::<String>);

    let media_id = media.id;
    let (client, local_mode) = {
        let state = app.read();
        (state.client.clone(), state.local_mode)
    };
    use_future(move || {
        let client = client.clone();
        async move {
            if !local_mode && let Some(client) = client {
                let (colors, artwork) = tokio::join!(
                    client.artwork_palette(media_id),
                    client.media_thumbnail(media_id),
                );
                if let Ok(colors) = colors {
                    palette.set(
                        colors
                            .colors
                            .into_iter()
                            .filter(|entry| {
                                crate::ui::lyrics_card::parse_hex(&entry.hex).is_some()
                                    && entry.percentage.is_finite()
                                    && (0.0..=100.0).contains(&entry.percentage)
                            })
                            .collect(),
                    );
                }
                if let Ok(bytes) = artwork {
                    let mime = artwork_mime(&bytes);
                    artwork_src.set(Some(format!(
                        "data:{mime};base64,{}",
                        base64::engine::general_purpose::STANDARD.encode(&bytes)
                    )));
                    artwork_bytes.set(Some(bytes));
                }
            }
            loading.set(false);
        }
    });

    let selected_range = selection();
    let selected: Vec<String> = selected_range
        .map(|(start, end)| {
            shareable[start..=end]
                .iter()
                .map(|line| line.text.clone())
                .collect()
        })
        .unwrap_or_default();
    let colors = palette();
    let selected_background = colors
        .get(palette_index())
        .map(|color| color.hex.as_str())
        .unwrap_or(DEFAULT_BACKGROUND)
        .to_owned();
    let foreground = text_color(&selected_background);
    let card_style = format!("background-color: {selected_background}; color: {foreground};");
    let title = media.title().trim().to_owned();
    let artist = media
        .artists
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Unknown artist")
        .trim()
        .to_owned();
    let art_preview = artwork_src();
    let is_busy = saving() || loading();

    rsx! {
        div { class: "dialog-backdrop lyrics-share-backdrop",
            section {
                class: "lyrics-share-dialog",
                role: "dialog",
                "aria-modal": "true",
                "aria-label": "Share lyrics",
                tabindex: "0",
                autofocus: true,
                onkeydown: move |event: KeyboardEvent| {
                    event.stop_propagation();
                    if event.key() == Key::Escape && !saving() {
                        open.set(false);
                    }
                },
                header { class: "lyrics-share-dialog-header",
                    div {
                        p { class: "eyebrow", "Dogmedia" }
                        h2 { "Share lyrics" }
                        span { "Choose up to five lines and a color from the artwork." }
                    }
                    button { class: "lyrics-share-close", title: "Close", onclick: move |_| open.set(false), "×" }
                }
                div { class: "lyrics-share-dialog-body",
                    div { class: "lyrics-share-picker", "aria-label": "Choose lyrics to share",
                        if shareable.is_empty() {
                            p { class: "lyrics-share-empty", "No lyrics available for this track." }
                        }
                        for (index, segment) in shareable.iter().enumerate().filter(|(index, _)| candidate.contains(index)) {
                            {
                                let selected_line = selected_range.is_some_and(|(start, end)| index >= start && index <= end);
                                let selectable = candidate.contains(&index);
                                let line_class = if selected_line { "lyrics-share-picker-line selected" } else { "lyrics-share-picker-line" };
                                rsx! {
                                    button {
                                        key: "{segment.start}-{index}",
                                        class: "{line_class}",
                                        disabled: !selectable || saving(),
                                        "aria-pressed": if selected_line { "true" } else { "false" },
                                        onclick: move |_| selection.set(update_selection(selection(), index)),
                                        "{segment.text}"
                                    }
                                }
                            }
                        }
                    }
                    div { class: "lyrics-share-preview-group",
                        div { class: "lyrics-share-card", style: "{card_style}", "aria-label": "Lyrics card preview",
                            div { class: "lyrics-share-card-brand",
                                img { src: "{brand_mark_data_url()}", alt: "Dogmedia" }
                                strong { "Dogmedia" }
                            }
                            div { class: "lyrics-share-card-copy",
                                for line in selected.iter() {
                                    p { "{line}" }
                                }
                            }
                            div { class: "lyrics-share-card-footer",
                                if let Some(src) = art_preview.as_ref() {
                                    img { src: "{src}", alt: "" }
                                } else {
                                    span { class: "lyrics-share-art-fallback", "♪" }
                                }
                                div {
                                    strong { "{title}" }
                                    span { "{artist}" }
                                }
                            }
                        }
                        if !colors.is_empty() {
                            div { class: "lyrics-share-colors", role: "group", "aria-label": "Background color",
                                span { "Background color" }
                                div { class: "lyrics-share-swatches",
                                    for (index, color) in colors.iter().enumerate() {
                                        {
                                            let swatch_style = format!("background-color: {}; color: {};", color.hex, text_color(&color.hex));
                                            let swatch_class = if palette_index() == index { "lyrics-share-swatch selected" } else { "lyrics-share-swatch" };
                                            let label = format!("{}, {:.2}% of artwork", color.hex, color.percentage);
                                            rsx! {
                                                button {
                                                    key: "{color.hex}-{index}",
                                                    class: "{swatch_class}",
                                                    style: "{swatch_style}",
                                                    title: "{label}",
                                                    "aria-label": "{label}",
                                                    "aria-pressed": if palette_index() == index { "true" } else { "false" },
                                                    disabled: saving(),
                                                    onclick: move |_| palette_index.set(index),
                                                    if palette_index() == index { "✓" }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                if let Some(message) = error() {
                    p { class: "lyrics-share-error", role: "alert", "{message}" }
                }
                footer { class: "lyrics-share-dialog-actions",
                    span { "{selected.len()}/5 lines selected · 16:9 PNG" }
                    button {
                        class: "lyrics-share-save",
                        disabled: is_busy || selected.is_empty(),
                        onclick: move |_| {
                            if selected.is_empty() || saving() || loading() { return; }
                            saving.set(true);
                            error.set(None);
                            let lines = selected.clone();
                            let color = selected_background.clone();
                            let title = title.clone();
                            let artist = artist.clone();
                            let art = artwork_bytes();
                            spawn(async move {
                                let result = tokio::task::spawn_blocking(move || -> Result<Option<std::path::PathBuf>, String> {
                                    let Some(mut path) = rfd::FileDialog::new()
                                        .add_filter("PNG image", &["png"])
                                        .set_file_name(filename(&title))
                                        .save_file() else { return Ok(None); };
                                    if !path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("png")) {
                                        path.set_extension("png");
                                    }
                                    let png = render_lyrics_card(&color, &lines, &title, &artist, art.as_deref())?;
                                    std::fs::write(&path, png).map_err(|error| format!("Unable to save image: {error}"))?;
                                    Ok(Some(path))
                                }).await;
                                match result {
                                    Ok(Ok(Some(path))) => {
                                        app.write().status = Some(format!("Lyrics card saved: {}", path.display()));
                                        open.set(false);
                                    }
                                    Ok(Ok(None)) => {}
                                    Ok(Err(message)) => error.set(Some(message)),
                                    Err(join_error) => error.set(Some(format!("Unable to create image: {join_error}"))),
                                }
                                saving.set(false);
                            });
                        },
                        if saving() { "Saving…" } else if loading() { "Loading colors…" } else { "Save PNG" }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selection_stays_contiguous_and_bounded() {
        assert_eq!(update_selection(Some((2, 2)), 3), Some((2, 3)));
        assert_eq!(update_selection(Some((2, 3)), 1), Some((1, 3)));
        assert_eq!(update_selection(Some((1, 5)), 0), Some((1, 5)));
        assert_eq!(update_selection(Some((2, 2)), 2), None);
        assert_eq!(share_window(12, 20), 10..15);
    }
}
