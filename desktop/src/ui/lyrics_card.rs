//! Shared 16:9 lyrics-card artwork for the native desktop client.

use std::{io::Cursor, sync::OnceLock};

use ab_glyph::{Font, FontArc, FontVec, PxScale, ScaleFont, point};
use image::{DynamicImage, ImageFormat, Rgba, RgbaImage, imageops};

pub(crate) const CARD_WIDTH: u32 = 1920;
pub(crate) const CARD_HEIGHT: u32 = 1080;
pub(crate) const DEFAULT_BACKGROUND: &str = "#202438";

pub(crate) fn parse_hex(value: &str) -> Option<[u8; 3]> {
    let bytes = value.as_bytes();
    if bytes.len() != 7 || bytes[0] != b'#' {
        return None;
    }
    let parse = |start| u8::from_str_radix(&value[start..start + 2], 16).ok();
    Some([parse(1)?, parse(3)?, parse(5)?])
}

pub(crate) fn text_color(background: &str) -> &'static str {
    let Some(channels) = parse_hex(background) else {
        return "#ffffff";
    };
    let luminance: f64 = channels
        .into_iter()
        .zip([0.2126, 0.7152, 0.0722])
        .map(|(channel, weight)| {
            let value = f64::from(channel) / 255.0;
            let linear = if value <= 0.04045 {
                value / 12.92
            } else {
                ((value + 0.055) / 1.055).powf(2.4)
            };
            linear * weight
        })
        .sum();
    if (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) {
        "#000000"
    } else {
        "#ffffff"
    }
}

fn font() -> Result<FontArc, String> {
    static FONT: OnceLock<Option<FontArc>> = OnceLock::new();
    FONT.get_or_init(|| {
        let mut database = fontdb::Database::new();
        database.load_system_fonts();
        let id = database.query(&fontdb::Query {
            families: &[fontdb::Family::SansSerif],
            weight: fontdb::Weight::BOLD,
            ..Default::default()
        })?;
        database
            .with_face_data(id, |data, index| {
                FontVec::try_from_vec_and_index(data.to_vec(), index)
                    .ok()
                    .map(FontArc::new)
            })
            .flatten()
    })
    .clone()
    .ok_or_else(|| "No system sans-serif font is available for the lyrics card.".to_owned())
}

fn line_width(font: &FontArc, text: &str, size: f32) -> f32 {
    let scaled = font.as_scaled(PxScale::from(size));
    let mut width = 0.0;
    let mut previous = None;
    for ch in text.chars() {
        let id = scaled.glyph_id(ch);
        if let Some(previous) = previous {
            width += scaled.kern(previous, id);
        }
        width += scaled.h_advance(id);
        previous = Some(id);
    }
    width
}

fn wrap_line(font: &FontArc, text: &str, size: f32, max_width: f32) -> Vec<String> {
    let mut rows = Vec::new();
    let mut row = String::new();
    for word in text.split_whitespace() {
        let candidate = if row.is_empty() {
            word.to_owned()
        } else {
            format!("{row} {word}")
        };
        if !row.is_empty() && line_width(font, &candidate, size) > max_width {
            rows.push(std::mem::take(&mut row));
            row.push_str(word);
        } else {
            row = candidate;
        }
    }
    if !row.is_empty() {
        rows.push(row);
    }
    rows
}

fn draw_text(
    image: &mut RgbaImage,
    font: &FontArc,
    text: &str,
    size: f32,
    x: f32,
    y: f32,
    color: Rgba<u8>,
) {
    let scaled = font.as_scaled(PxScale::from(size));
    let mut cursor = x;
    let mut previous = None;
    for ch in text.chars() {
        let id = scaled.glyph_id(ch);
        if let Some(previous) = previous {
            cursor += scaled.kern(previous, id);
        }
        let glyph = id.with_scale_and_position(size, point(cursor, y));
        if let Some(outline) = scaled.outline_glyph(glyph) {
            let bounds = outline.px_bounds();
            outline.draw(|px, py, coverage| {
                let draw_x = bounds.min.x as i32 + px as i32;
                let draw_y = bounds.min.y as i32 + py as i32;
                if draw_x >= 0 && draw_y >= 0 {
                    if let Some(pixel) = image.get_pixel_mut_checked(draw_x as u32, draw_y as u32) {
                        let alpha = coverage * f32::from(color[3]) / 255.0;
                        for channel in 0..3 {
                            pixel[channel] = (f32::from(pixel[channel]) * (1.0 - alpha)
                                + f32::from(color[channel]) * alpha)
                                .round() as u8;
                        }
                    }
                }
            });
        }
        cursor += scaled.h_advance(id);
        previous = Some(id);
    }
}

fn fitted_text(font: &FontArc, text: &str, size: f32, max_width: f32) -> String {
    if line_width(font, text, size) <= max_width {
        return text.to_owned();
    }
    let mut shortened = text.to_owned();
    while !shortened.is_empty() && line_width(font, &format!("{shortened}…"), size) > max_width {
        shortened.pop();
    }
    format!("{}…", shortened.trim_end())
}

pub(crate) fn render_lyrics_card(
    background: &str,
    lyrics: &[String],
    title: &str,
    artist: &str,
    artwork: Option<&[u8]>,
) -> Result<Vec<u8>, String> {
    if lyrics.is_empty() {
        return Err("Select at least one lyric line.".to_owned());
    }
    let font = font()?;
    let background_rgb = parse_hex(background).ok_or("Invalid palette color.")?;
    let foreground_rgb = parse_hex(text_color(background)).expect("fixed hex color");
    let foreground = Rgba([foreground_rgb[0], foreground_rgb[1], foreground_rgb[2], 255]);
    let mut image = RgbaImage::from_pixel(
        CARD_WIDTH,
        CARD_HEIGHT,
        Rgba([background_rgb[0], background_rgb[1], background_rgb[2], 255]),
    );

    // The logo, quote, separator, and media details follow the web card's 640×360 layout at 3×.
    if let Ok(logo) = image::load_from_memory(include_bytes!("../../assets/brand-mark.png")) {
        let logo = logo
            .resize_to_fill(78, 78, imageops::FilterType::Lanczos3)
            .into_rgba8();
        imageops::overlay(&mut image, &logo, 90, 78);
    }
    draw_text(
        &mut image, &font, "Dogmedia", 42.0, 192.0, 135.0, foreground,
    );

    let mut chosen_size = 78.0;
    let rows = loop {
        let rows: Vec<String> = lyrics
            .iter()
            .flat_map(|line| wrap_line(&font, line, chosen_size, 1720.0))
            .collect();
        let height = rows.len() as f32 * chosen_size * 1.18;
        if height <= 490.0 || chosen_size <= 42.0 {
            break rows;
        }
        chosen_size -= 3.0;
    };
    let row_height = chosen_size * 1.18;
    let total_height = rows.len() as f32 * row_height;
    let first_baseline = 245.0 + ((495.0 - total_height).max(0.0) / 2.0) + chosen_size;
    for (index, row) in rows.iter().enumerate() {
        draw_text(
            &mut image,
            &font,
            row,
            chosen_size,
            90.0,
            first_baseline + index as f32 * row_height,
            foreground,
        );
    }

    for x in 90..1830 {
        for y in 812..815 {
            image.put_pixel(x, y, foreground);
        }
    }
    let decoded_artwork = artwork.and_then(|bytes| image::load_from_memory(bytes).ok());
    if let Some(artwork) = decoded_artwork {
        let artwork = artwork
            .resize_to_fill(144, 144, imageops::FilterType::Lanczos3)
            .into_rgba8();
        imageops::overlay(&mut image, &artwork, 90, 850);
    } else {
        draw_text(&mut image, &font, "♪", 75.0, 126.0, 952.0, foreground);
    }
    let title = fitted_text(&font, title, 45.0, 1560.0);
    let artist = fitted_text(&font, artist, 33.0, 1560.0);
    draw_text(&mut image, &font, &title, 45.0, 270.0, 914.0, foreground);
    draw_text(&mut image, &font, &artist, 33.0, 270.0, 966.0, foreground);

    let mut cursor = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(image)
        .write_to(&mut cursor, ImageFormat::Png)
        .map_err(|error| format!("Unable to encode lyrics card: {error}"))?;
    Ok(cursor.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn palette_colors_choose_best_black_or_white_contrast() {
        assert_eq!(text_color("#efefef"), "#000000");
        assert_eq!(text_color("#080807"), "#ffffff");
        assert_eq!(text_color("#b6ae5d"), "#000000");
        assert_eq!(text_color("bad"), "#ffffff");
    }

    #[test]
    fn card_is_1920_by_1080_and_uses_the_selected_solid_color() {
        let png = render_lyrics_card(
            "#b6ae5d",
            &["A lyric to share".to_owned()],
            "Song",
            "Artist",
            None,
        )
        .unwrap();
        let decoded = image::load_from_memory(&png).unwrap();
        assert_eq!(
            (decoded.width(), decoded.height()),
            (CARD_WIDTH, CARD_HEIGHT)
        );
        assert_eq!(
            decoded.to_rgba8().get_pixel(0, 0),
            &Rgba([0xb6, 0xae, 0x5d, 255])
        );
    }
}
