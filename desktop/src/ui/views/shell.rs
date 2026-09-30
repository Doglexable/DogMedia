use iced::{
    Alignment, Element, Fill,
    widget::{button, column, container, row, rule, space, text},
};

use crate::app::AccessView;

use super::super::application::{Dogmedia, Message};
use super::super::{components, theme};
use super::{library, player_bar, queue_panel};

pub(crate) fn render(app: &Dogmedia) -> Element<'_, Message> {
    let brand = column![
        text("DOGMEDIA").size(theme::type_scale::BODY_SMALL),
        text("Private listening room").size(22),
    ]
    .spacing(2);
    let access = match &app.library.access {
        AccessView::Ready => "● Connected",
        AccessView::Checking => "◌ Connecting",
        AccessView::Denied => "● Access denied",
        AccessView::Unreachable(_) => "● Offline",
        AccessView::FirstRun => "● Setup required",
    };
    let header = row![
        brand,
        space().width(Fill),
        text(access).size(theme::type_scale::BODY),
        button("Refresh").on_press(Message::Refresh),
        button("Settings").on_press(Message::OpenSettings),
    ]
    .spacing(12)
    .align_y(Alignment::Center)
    .padding([14, 20]);

    let content = row![library::render(app), queue_panel::render(app)].height(Fill);
    let mut page = column![header, rule::horizontal(1)].height(Fill);
    if let Some(status) = &app.status {
        let banner = match status.retry_after {
            Some(seconds) => format!("{} (retry in {seconds}s)", status.message),
            None => status.message.clone(),
        };
        page = page.push(components::status_banner(banner));
    }
    page = page.push(content).push(player_bar::render(app));
    container(page).width(Fill).height(Fill).into()
}
