use gtk::prelude::*;

pub struct PlayerView {
    pub root: gtk::Box,
    pub picture: gtk::Picture,
    pub title: gtk::Label,
    pub play: gtk::Button,
    pub stop: gtk::Button,
    pub previous: gtk::Button,
    pub next: gtk::Button,
    pub position: gtk::Scale,
    pub volume: gtk::Scale,
    pub quality: gtk::DropDown,
    pub favorite: gtk::ToggleButton,
    pub add_queue: gtk::Button,
    pub play_next: gtk::Button,
    pub lyrics: gtk::Label,
    pub subtitles: gtk::DropDown,
    pub subtitle_model: gtk::StringList,
}

pub fn build() -> PlayerView {
    let root = gtk::Box::new(gtk::Orientation::Vertical, 4);
    root.add_css_class("player-bar");
    let picture = gtk::Picture::builder()
        .height_request(220)
        .can_shrink(true)
        .content_fit(gtk::ContentFit::Contain)
        .build();
    picture.set_visible(false);
    root.append(&picture);
    let lyrics = gtk::Label::builder()
        .xalign(0.5)
        .wrap(true)
        .selectable(true)
        .build();
    lyrics.add_css_class("lyrics");
    lyrics.set_tooltip_text(Some(
        "Lyrics are displayed as text; synchronized highlighting is not available yet",
    ));
    lyrics.set_visible(false);
    root.append(&lyrics);

    let row = gtk::Box::new(gtk::Orientation::Horizontal, 7);
    row.set_margin_top(8);
    row.set_margin_bottom(8);
    row.set_margin_start(12);
    row.set_margin_end(12);
    let previous = icon_button("media-skip-backward-symbolic", "Previous");
    let play = icon_button("media-playback-start-symbolic", "Play or pause");
    play.add_css_class("suggested-action");
    let stop = icon_button("media-playback-stop-symbolic", "Stop");
    let next = icon_button("media-skip-forward-symbolic", "Next");
    let title = gtk::Label::builder()
        .label("Nothing playing")
        .xalign(0.0)
        .hexpand(true)
        .ellipsize(gtk::pango::EllipsizeMode::End)
        .build();
    let position = gtk::Scale::with_range(gtk::Orientation::Horizontal, 0.0, 1.0, 1.0);
    position.set_width_request(240);
    position.set_draw_value(false);
    position.set_tooltip_text(Some("Seek"));
    let volume = gtk::Scale::with_range(gtk::Orientation::Horizontal, 0.0, 1.0, 0.05);
    volume.set_width_request(100);
    volume.set_value(0.8);
    volume.set_tooltip_text(Some("Volume"));
    let quality = gtk::DropDown::from_strings(&["Low", "Medium", "High", "Original"]);
    quality.set_selected(2);
    quality.set_tooltip_text(Some("Playback quality"));
    let favorite = gtk::ToggleButton::builder()
        .icon_name("non-starred-symbolic")
        .tooltip_text("Like or unlike this audio item")
        .build();
    let add_queue = icon_button("list-add-symbolic", "Add to queue");
    let play_next = icon_button("go-next-symbolic", "Play next");
    let subtitle_model = gtk::StringList::new(&["Subtitles off"]);
    let subtitles = gtk::DropDown::new(Some(subtitle_model.clone()), None::<gtk::Expression>);
    subtitles.set_tooltip_text(Some("Subtitle track"));
    row.append(&previous);
    row.append(&play);
    row.append(&stop);
    row.append(&next);
    row.append(&title);
    row.append(&position);
    row.append(&quality);
    row.append(&favorite);
    row.append(&add_queue);
    row.append(&play_next);
    row.append(&subtitles);
    row.append(&volume);
    root.append(&row);
    PlayerView {
        root,
        picture,
        title,
        play,
        stop,
        previous,
        next,
        position,
        volume,
        quality,
        favorite,
        add_queue,
        play_next,
        lyrics,
        subtitles,
        subtitle_model,
    }
}

fn icon_button(icon: &str, tooltip: &str) -> gtk::Button {
    let button = gtk::Button::from_icon_name(icon);
    button.set_tooltip_text(Some(tooltip));
    button
}
