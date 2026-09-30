use iced::{
    Element,
    widget::{button, checkbox, column, row, text, text_input},
};

use super::super::application::{Dogmedia, Message};
use super::super::{components, theme};

pub(crate) fn render(app: &Dogmedia) -> Element<'_, Message> {
    let fields = column![
        text("Connect Dogmedia").size(theme::type_scale::DISPLAY),
        text("Use the address of the server available to this computer."),
        text("Server URL").size(theme::type_scale::BODY),
        text_input("https://media.example.test/", &app.settings_url)
            .on_input(Message::SettingsUrlChanged)
            .padding(12),
        checkbox(app.allow_http)
            .label("Allow plain HTTP on a trusted LAN")
            .on_toggle(Message::AllowHttpChanged),
        text("HTTPS is recommended. The server still enforces its IP whitelist.")
            .size(theme::type_scale::BODY_SMALL),
        row![
            button("Cancel").on_press(Message::CloseSettings),
            button("Save and connect")
                .on_press(Message::SaveSettings)
                .style(button::primary),
        ]
        .spacing(10),
    ]
    .spacing(14)
    .width(520);
    components::dialog_panel(fields)
}
