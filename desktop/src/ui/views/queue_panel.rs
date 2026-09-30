use iced::{
    Element, Fill, FillPortion,
    widget::{button, column, container, row, rule, scrollable, text},
};

use super::super::application::{Dogmedia, Message};
use super::super::{components, theme};

pub(crate) fn render(app: &Dogmedia) -> Element<'_, Message> {
    let mut items = column![].spacing(3);
    if let Some(queue) = &app.queue {
        for item in &queue.items {
            let current = Some(item.media.id) == queue.current_media_id;
            let selected = app.selected_queue == Some(item.media.id);
            let label = row![
                text(if current { "▶" } else { " " }).width(20),
                text(item.media.title()).size(14),
            ]
            .spacing(6);
            let item_button = button(label)
                .on_press(Message::QueuePressed(item.media.id))
                .width(Fill);
            let item_button = if current || selected {
                item_button.style(button::secondary)
            } else {
                item_button.style(button::text)
            };
            items = items.push(item_button);
        }
    }
    let actions = row![
        button("Remove").on_press_maybe(app.selected_queue.map(|_| Message::QueueRemove)),
        button("Shuffle").on_press(Message::QueueShuffle),
        button("Clear").on_press(Message::QueueClear),
    ]
    .spacing(6);
    container(
        column![
            components::section_header(
                "Up next",
                theme::type_scale::TITLE,
                app.queue
                    .as_ref()
                    .map_or("0".into(), |queue| queue.total.to_string()),
            ),
            rule::horizontal(1),
            scrollable(items).height(Fill),
            actions,
        ]
        .spacing(10),
    )
    .padding([14, 16])
    .width(FillPortion(1))
    .height(Fill)
    .style(theme::card_style)
    .into()
}
