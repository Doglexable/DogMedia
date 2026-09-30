use iced::{
    Alignment, Element, Fill, FillPortion,
    widget::{button, checkbox, column, pick_list, row, rule, scrollable, space, text, text_input},
};

use crate::domain::MediaFilter;

use super::super::application::{Dogmedia, Message};
use super::super::{components, theme};

pub(crate) fn render(app: &Dogmedia) -> Element<'_, Message> {
    let filters = row![
        text_input("Search your library", &app.search)
            .on_input(Message::SearchChanged)
            .padding(11)
            .width(FillPortion(3)),
        pick_list(
            MediaFilter::ALL,
            Some(app.media_filter),
            Message::MediaFilterChanged
        )
        .width(FillPortion(1)),
        pick_list(
            app.category_choices(),
            Some(app.category.clone()),
            Message::CategoryChanged
        )
        .width(FillPortion(2)),
        checkbox(app.favorites_only)
            .label("Favorites")
            .on_toggle(Message::FavoritesChanged),
    ]
    .spacing(10)
    .align_y(Alignment::Center);

    let mut media_rows = column![].spacing(4);
    for media in &app.library.items {
        let selected = app.current_media_id() == Some(media.id);
        let kind = media
            .mime_type
            .as_deref()
            .and_then(|mime| mime.split('/').next())
            .unwrap_or("media");
        let metadata = if media.subtitle().is_empty() {
            kind.to_owned()
        } else {
            format!("{}  ·  {kind}", media.subtitle())
        };
        let item = row![
            text(if selected { "▶" } else { " " }).width(24),
            column![
                text(media.title()).size(theme::type_scale::TITLE_SMALL),
                text(metadata).size(theme::type_scale::BODY_SMALL)
            ]
            .spacing(3),
            space().width(Fill),
            text(components::format_duration(media.duration.unwrap_or(0.0)))
                .size(theme::type_scale::BODY_SMALL),
        ]
        .align_y(Alignment::Center)
        .padding([9, 10]);
        let item_button = button(item)
            .on_press(Message::MediaPressed(media.id))
            .width(Fill);
        let item_button = if selected {
            item_button.style(theme::selected_button)
        } else {
            item_button.style(button::text)
        };
        media_rows = media_rows.push(item_button);
    }
    if app.library.items.is_empty() && !app.library.loading {
        media_rows = media_rows.push(components::empty_state(
            "Nothing here yet",
            "Change the filters or refresh the library.",
        ));
    }
    if app.library.loading {
        media_rows = media_rows.push(components::loading_row("Loading library…"));
    } else if app.library.next_cursor.is_some() {
        media_rows = media_rows.push(button("Load more").on_press(Message::LoadMore).width(Fill));
    }
    column![
        components::section_header(
            "Library",
            theme::type_scale::HEADLINE,
            format!("{} items", app.library.items.len()),
        ),
        filters,
        rule::horizontal(1),
        scrollable(media_rows).height(Fill),
    ]
    .spacing(12)
    .padding([16, 20])
    .width(FillPortion(3))
    .into()
}
