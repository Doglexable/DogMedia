//! Shared view primitives: rust-ui component equivalents for Iced.
//!
//! Mapping: `card` → [`card_panel`], `dialog` → [`dialog_panel`],
//! `sonner`/`toast` → [`status_banner`], `empty` → [`empty_state`],
//! section headings → [`section_header`].

use iced::{
    Element, Fill,
    widget::{button, column, container, row, space, text},
};

use super::application::Message;
use super::theme::{self, type_scale};

/// Centered dialog panel (settings, first-run).
pub fn dialog_panel<'a>(content: impl Into<Element<'a, Message>>) -> Element<'a, Message> {
    container(
        container(content)
            .padding(30)
            .width(580)
            .style(theme::card_style),
    )
    .center_x(Fill)
    .center_y(Fill)
    .width(Fill)
    .height(Fill)
    .into()
}

/// Status banner with a dismiss action (`sonner` equivalent).
pub fn status_banner<'a>(banner: String) -> Element<'a, Message> {
    row![
        text(banner).size(type_scale::BODY),
        space().width(Fill),
        button("Dismiss").on_press(Message::DismissStatus)
    ]
    .spacing(10)
    .align_y(iced::Alignment::Center)
    .padding([8, 20])
    .into()
}

/// Section heading with a trailing meta label (`Library` / `Up next`).
pub fn section_header<'a>(title: &'a str, title_size: f32, meta: String) -> Element<'a, Message> {
    row![
        text(title).size(title_size),
        space().width(Fill),
        text(meta).size(type_scale::BODY_SMALL)
    ]
    .align_y(iced::Alignment::Center)
    .into()
}

/// Empty-collection placeholder (`empty` equivalent).
pub fn empty_state<'a>(title: &'a str, hint: &'a str) -> Element<'a, Message> {
    container(column![text(title).size(type_scale::TITLE), text(hint),].spacing(6))
        .padding(30)
        .center_x(Fill)
        .into()
}

/// Format a position/duration in seconds as `M:SS` or `H:MM:SS`.
pub fn format_duration(seconds: f64) -> String {
    let total = seconds.max(0.0) as u64;
    let hours = total / 3600;
    let minutes = (total % 3600) / 60;
    let seconds = total % 60;
    if hours > 0 {
        format!("{hours}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes}:{seconds:02}")
    }
}

/// Loading hint row (`skeleton` equivalent).
pub fn loading_row<'a>(label: &'a str) -> Element<'a, Message> {
    text(label).size(type_scale::BODY).into()
}
