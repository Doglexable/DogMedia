use adw::prelude::*;

pub fn present(
    parent: &adw::ApplicationWindow,
    current_url: &str,
    on_save: impl Fn(String, bool) + 'static,
) {
    let dialog = adw::Dialog::builder()
        .title("Dogmedia Settings")
        .content_width(520)
        .build();
    let toolbar = adw::ToolbarView::new();
    let header = adw::HeaderBar::new();
    let save = gtk::Button::with_label("Save");
    save.add_css_class("suggested-action");
    header.pack_end(&save);
    toolbar.add_top_bar(&header);
    let content = gtk::Box::new(gtk::Orientation::Vertical, 12);
    content.set_margin_top(18);
    content.set_margin_bottom(18);
    content.set_margin_start(18);
    content.set_margin_end(18);
    let label = gtk::Label::builder()
        .label("Server URL")
        .xalign(0.0)
        .build();
    let entry = gtk::Entry::builder()
        .text(current_url)
        .placeholder_text("https://media.example.test/")
        .build();
    let allow_http = gtk::CheckButton::with_label("Allow plain HTTP on a trusted LAN");
    let hint = gtk::Label::builder()
        .label("HTTPS is recommended. The server still enforces its IP whitelist.")
        .xalign(0.0)
        .wrap(true)
        .build();
    hint.add_css_class("dim-label");
    content.append(&label);
    content.append(&entry);
    content.append(&allow_http);
    content.append(&hint);
    toolbar.set_content(Some(&content));
    dialog.set_child(Some(&toolbar));
    save.connect_clicked(glib::clone!(
        #[weak]
        dialog,
        #[weak]
        entry,
        #[weak]
        allow_http,
        move |_| {
            on_save(entry.text().to_string(), allow_http.is_active());
            dialog.close();
        }
    ));
    dialog.present(Some(parent));
}
