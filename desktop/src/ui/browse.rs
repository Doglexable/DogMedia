use gtk::prelude::*;

use crate::domain::{Category, Media};

pub struct BrowseView {
    pub root: gtk::Box,
    pub search: gtk::SearchEntry,
    pub media_type: gtk::DropDown,
    pub categories: gtk::DropDown,
    pub category_model: gtk::StringList,
    pub favorites: gtk::ToggleButton,
    pub model: gtk::StringList,
    pub list: gtk::ListView,
    pub scroll: gtk::ScrolledWindow,
    pub spinner: gtk::Spinner,
}

pub fn build() -> BrowseView {
    let root = gtk::Box::new(gtk::Orientation::Vertical, 12);
    root.set_margin_top(16);
    root.set_margin_bottom(16);
    root.set_margin_start(16);
    root.set_margin_end(16);

    let controls = gtk::Box::new(gtk::Orientation::Horizontal, 8);
    let search = gtk::SearchEntry::builder()
        .placeholder_text("Search library")
        .hexpand(true)
        .build();
    search.set_tooltip_text(Some("Search media (Ctrl+F)"));
    let media_type = gtk::DropDown::from_strings(&["All", "Audio", "Video", "Photos"]);
    media_type.set_tooltip_text(Some("Filter by media type"));
    let category_model = gtk::StringList::new(&["All categories"]);
    let categories = gtk::DropDown::new(Some(category_model.clone()), None::<gtk::Expression>);
    categories.set_tooltip_text(Some("Filter by category"));
    let favorites = gtk::ToggleButton::builder()
        .icon_name("starred-symbolic")
        .tooltip_text("Favorites only")
        .build();
    let spinner = gtk::Spinner::new();
    controls.append(&search);
    controls.append(&media_type);
    controls.append(&categories);
    controls.append(&favorites);
    controls.append(&spinner);
    root.append(&controls);

    let model = gtk::StringList::new(&[]);
    let selection = gtk::NoSelection::new(Some(model.clone()));
    let factory = gtk::SignalListItemFactory::new();
    factory.connect_setup(|_, list_item| {
        let Some(list_item) = list_item.downcast_ref::<gtk::ListItem>() else {
            return;
        };
        let label = gtk::Label::builder()
            .xalign(0.0)
            .wrap(true)
            .margin_top(10)
            .margin_bottom(10)
            .margin_start(12)
            .margin_end(12)
            .build();
        list_item.set_child(Some(&label));
    });
    factory.connect_bind(|_, list_item| {
        let Some(list_item) = list_item.downcast_ref::<gtk::ListItem>() else {
            return;
        };
        if let (Some(label), Some(value)) = (
            list_item.child().and_downcast::<gtk::Label>(),
            list_item.item().and_downcast::<gtk::StringObject>(),
        ) {
            label.set_label(&value.string());
        }
    });
    let list = gtk::ListView::new(Some(selection), Some(factory));
    list.update_property(&[gtk::accessible::Property::Label("Media library")]);
    let scroll = gtk::ScrolledWindow::builder()
        .child(&list)
        .vexpand(true)
        .build();
    root.append(&scroll);
    BrowseView {
        root,
        search,
        media_type,
        categories,
        category_model,
        favorites,
        model,
        list,
        scroll,
        spinner,
    }
}

impl BrowseView {
    pub fn set_items(&self, items: &[Media]) {
        let rows: Vec<String> = items
            .iter()
            .map(|media| {
                let kind = media
                    .mime_type
                    .as_deref()
                    .unwrap_or("media")
                    .split('/')
                    .next()
                    .unwrap_or("media");
                if media.subtitle().is_empty() {
                    format!("{}  ·  {kind}", media.title())
                } else {
                    format!("{}\n{}  ·  {kind}", media.title(), media.subtitle())
                }
            })
            .collect();
        let values: Vec<&str> = rows.iter().map(String::as_str).collect();
        self.model.splice(0, self.model.n_items(), &values);
    }

    pub fn set_categories(&self, categories: &[Category]) {
        let mut names = vec!["All categories".to_owned()];
        names.extend(categories.iter().map(|category| {
            let indent = "  ".repeat(category.depth as usize);
            format!("{indent}{}", category.name)
        }));
        let values: Vec<&str> = names.iter().map(String::as_str).collect();
        self.category_model
            .splice(0, self.category_model.n_items(), &values);
        self.categories.set_selected(0);
    }
}
