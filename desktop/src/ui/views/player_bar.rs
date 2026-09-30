use iced::{
    Alignment, Element, Fill, FillPortion, Length,
    widget::{button, column, container, image, pick_list, row, slider, text},
};

use crate::domain::{Media, Quality};

use super::super::application::{Dogmedia, Message};
use super::super::{components, theme};
use crate::playback::PlaybackStatus;

pub(crate) fn render(app: &Dogmedia) -> Element<'_, Message> {
    let snapshot = app.coordinator.snapshot();
    let playing = snapshot.status == PlaybackStatus::Playing;
    let title = snapshot
        .media
        .as_ref()
        .map_or("Nothing playing", Media::title);
    let subtitle = snapshot
        .media
        .as_ref()
        .map(Media::subtitle)
        .filter(|value| !value.is_empty())
        .unwrap_or("Select something from your library");
    let duration = snapshot.duration.max(1.0);
    let seek = slider(
        0.0..=duration,
        snapshot.position.min(duration),
        Message::Seek,
    );
    let time = format!(
        "{} / {}",
        components::format_duration(snapshot.position),
        components::format_duration(snapshot.duration)
    );

    let mut deck = column![].spacing(8);
    if let Some(handle) = &app.artwork {
        deck = deck.push(
            container(
                image(handle.clone())
                    .height(Length::Fixed(210.0))
                    .width(Fill),
            )
            .height(220)
            .width(Fill),
        );
    }
    let transport = row![
        button("⏮").on_press(Message::Previous),
        button(if playing { "Pause" } else { "Play" })
            .on_press(Message::TogglePlayback)
            .style(button::primary),
        button("Stop").on_press(Message::Stop),
        button("⏭").on_press(Message::Next),
        column![
            text(title).size(17),
            text(subtitle).size(theme::type_scale::BODY_SMALL)
        ]
        .spacing(2)
        .width(FillPortion(2)),
        column![seek, text(time).size(theme::type_scale::CAPTION)]
            .spacing(2)
            .width(FillPortion(3)),
        pick_list(
            Quality::ALL,
            Some(snapshot.quality),
            Message::QualityChanged
        ),
        button(if snapshot.media.as_ref().is_some_and(|m| m.liked) {
            "★"
        } else {
            "☆"
        })
        .on_press(Message::FavoriteChanged(
            !snapshot.media.as_ref().is_some_and(|m| m.liked)
        )),
        button("+ Queue").on_press(Message::AddToQueue(false)),
        button("Play next").on_press(Message::AddToQueue(true)),
        text("Vol").size(theme::type_scale::CAPTION),
        slider(0.0..=1.0, app.volume.get(), Message::VolumeChanged).width(90),
    ]
    .spacing(8)
    .align_y(Alignment::Center);
    deck = deck.push(transport);
    if !app.lyrics.is_empty() {
        deck = deck.push(text(&app.lyrics).size(theme::type_scale::BODY));
    }
    if !app.subtitles.is_empty() {
        deck = deck.push(
            pick_list(
                app.subtitle_choices(),
                Some(app.subtitle.clone()),
                Message::SubtitleChanged,
            )
            .width(220),
        );
    }
    container(deck)
        .padding([12, 18])
        .width(Fill)
        .style(theme::card_style)
        .into()
}
