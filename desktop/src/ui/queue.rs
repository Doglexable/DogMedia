use gtk::prelude::*;

use crate::domain::QueueWindow;

pub struct QueueView {
    pub root: gtk::Box,
    pub model: gtk::StringList,
    pub selection: gtk::SingleSelection,
    pub remove: gtk::Button,
    pub clear: gtk::Button,
    pub shuffle: gtk::Button,
}

pub fn build() -> QueueView {
    let root = gtk::Box::new(gtk::Orientation::Vertical, 8);
    root.add_css_class("queue-panel");
    root.set_width_request(280);
    root.set_margin_top(12);
    root.set_margin_bottom(12);
    root.set_margin_start(12);
    root.set_margin_end(12);
    let title = gtk::Label::builder().label("Queue").xalign(0.0).build();
    title.add_css_class("title-3");
    root.append(&title);
    let model = gtk::StringList::new(&[]);
    let selection = gtk::SingleSelection::new(Some(model.clone()));
    let factory = gtk::SignalListItemFactory::new();
    factory.connect_setup(|_, item| {
        let Some(item) = item.downcast_ref::<gtk::ListItem>() else {
            return;
        };
        item.set_child(Some(
            &gtk::Label::builder()
                .xalign(0.0)
                .ellipsize(gtk::pango::EllipsizeMode::End)
                .margin_top(6)
                .margin_bottom(6)
                .build(),
        ));
    });
    factory.connect_bind(|_, item| {
        let Some(item) = item.downcast_ref::<gtk::ListItem>() else {
            return;
        };
        if let (Some(label), Some(value)) = (
            item.child().and_downcast::<gtk::Label>(),
            item.item().and_downcast::<gtk::StringObject>(),
        ) {
            label.set_label(&value.string());
        }
    });
    let list = gtk::ListView::new(Some(selection.clone()), Some(factory));
    root.append(
        &gtk::ScrolledWindow::builder()
            .child(&list)
            .vexpand(true)
            .build(),
    );
    let actions = gtk::Box::new(gtk::Orientation::Horizontal, 6);
    let remove = gtk::Button::with_label("Remove");
    let clear = gtk::Button::with_label("Clear");
    let shuffle = gtk::Button::with_label("Shuffle");
    actions.append(&remove);
    actions.append(&clear);
    actions.append(&shuffle);
    root.append(&actions);
    QueueView {
        root,
        model,
        selection,
        remove,
        clear,
        shuffle,
    }
}

impl QueueView {
    pub fn set_window(&self, window: &QueueWindow) {
        let rows: Vec<String> = window
            .items
            .iter()
            .map(|item| {
                let marker = if Some(item.media.id) == window.current_media_id {
                    "▶ "
                } else {
                    ""
                };
                format!("{marker}{}", item.media.title())
            })
            .collect();
        let values: Vec<&str> = rows.iter().map(String::as_str).collect();
        self.model.splice(0, self.model.n_items(), &values);
        let local = window.current_index.saturating_sub(window.offset);
        if local < window.items.len() {
            self.selection.set_selected(local as u32);
        }
    }
}
