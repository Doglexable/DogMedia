pub mod browse;
pub mod player;
pub mod queue;
pub mod settings;
pub mod window;

pub use window::build_window;

pub fn load_style() {
    let provider = gtk::CssProvider::new();
    provider.load_from_resource("/com/dogmedia/Desktop/style.css");
    if let Some(display) = gtk::gdk::Display::default() {
        gtk::style_context_add_provider_for_display(
            &display,
            &provider,
            gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
        );
    }
}
