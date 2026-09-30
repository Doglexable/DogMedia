//! Design tokens ported from the rust-ui Default theme
//! (<https://rust-ui.com>, `:root` / `.dark` oklch variables).
//!
//! rust-ui ships Leptos/Tailwind web components, so there is no native crate
//! to depend on here. Instead this module freezes the theme's semantic values
//! (background, card, border, radius, …) as [`iced::Color`] constants plus the
//! shared container/button styles built from them.

use iced::{
    Border, Color, Shadow, Theme, Vector,
    widget::{button, container},
};

/// Corner radius: rust-ui `--radius: 0.5rem` at the default 16px root font.
pub const RADIUS: f32 = 8.0;
/// Card radius used for panels (`card`, `dialog`).
pub const RADIUS_CARD: f32 = 12.0;

/// Base font sizes used across the desktop views.
pub mod type_scale {
    pub const CAPTION: f32 = 11.0;
    pub const BODY_SMALL: f32 = 12.0;
    pub const BODY: f32 = 13.0;
    pub const TITLE_SMALL: f32 = 16.0;
    pub const TITLE: f32 = 20.0;
    pub const HEADLINE: f32 = 26.0;
    pub const DISPLAY: f32 = 30.0;
}

/// Brand accent. rust-ui's Default `primary` is near-black; the desktop keeps
/// the established rose accent and maps the remaining tokens 1:1.
pub const BRAND: Color = Color::from_rgb(225.0 / 255.0, 29.0 / 255.0, 72.0 / 255.0);

/// Light theme surface tokens (`:root`).
pub mod light {
    use super::Color;

    /// `--background`, `--card`, `--popover`.
    pub const SURFACE: Color = Color::from_rgb(248.0 / 255.0, 248.0 / 255.0, 247.0 / 255.0);
    pub const CARD: Color = Color::WHITE;
    /// `--foreground`, `--card-foreground`.
    pub const INK: Color = Color::from_rgb(10.0 / 255.0, 10.0 / 255.0, 10.0 / 255.0);
    /// `--border` / `--input` at 10% black.
    pub const BORDER: Color = Color::from_rgba(0.0, 0.0, 0.0, 0.10);
}

/// Dark theme surface tokens (`.dark`).
pub mod dark {
    use super::Color;

    pub const SURFACE: Color = Color::from_rgb(10.0 / 255.0, 10.0 / 255.0, 10.0 / 255.0);
    /// `--card` / `--popover`.
    pub const CARD: Color = Color::from_rgb(24.0 / 255.0, 24.0 / 255.0, 24.0 / 255.0);
    /// `--foreground` / `--card-foreground`.
    pub const INK: Color = Color::from_rgb(245.0 / 255.0, 245.0 / 255.0, 244.0 / 255.0);
    /// `--border` at 10% white.
    pub const BORDER: Color = Color::from_rgba(1.0, 1.0, 1.0, 0.11);
}

/// Card/panel surface: rust-ui `card` + `dialog` equivalent.
pub fn card_style(theme: &Theme) -> container::Style {
    let dark = theme.extended_palette().is_dark;
    container::Style::default()
        .color(if dark { dark::INK } else { light::INK })
        .background(if dark { dark::CARD } else { light::CARD })
        .border(Border {
            color: if dark { dark::BORDER } else { light::BORDER },
            width: 1.0,
            radius: RADIUS_CARD.into(),
        })
        .shadow(Shadow {
            color: Color::from_rgba(0.0, 0.0, 0.0, if dark { 0.28 } else { 0.08 }),
            offset: Vector::new(0.0, 4.0),
            blur_radius: if dark { 20.0 } else { 16.0 },
        })
}

/// Selected-row highlight: rust-ui `toggle-group` active state equivalent.
pub fn selected_button(theme: &Theme, status: button::Status) -> button::Style {
    let dark = theme.extended_palette().is_dark;
    let alpha = match status {
        button::Status::Hovered => 0.16,
        button::Status::Pressed => 0.20,
        button::Status::Disabled => 0.05,
        button::Status::Active => 0.09,
    };
    button::Style {
        background: Some(Color { a: alpha, ..BRAND }.into()),
        text_color: if dark { dark::INK } else { light::INK },
        border: Border {
            color: BRAND,
            width: 1.0,
            radius: RADIUS.into(),
        },
        ..button::text(theme, status)
    }
}
