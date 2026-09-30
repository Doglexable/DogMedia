use adw::prelude::*;
use dogmedia_desktop::{APP_ID, ui};

fn main() -> glib::ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .without_time()
        .init();
    let application = adw::Application::builder().application_id(APP_ID).build();
    application.connect_startup(|_| {
        gtk::gio::resources_register_include!("dogmedia.gresource")
            .expect("embedded desktop resources must register");
        ui::load_style();
    });
    application.connect_activate(|application| {
        if let Some(window) = application.active_window() {
            window.present();
            return;
        }
        ui::build_window(application).present();
    });
    application.run()
}
