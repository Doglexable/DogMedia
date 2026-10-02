pub mod api;
pub mod app;
pub mod domain;
pub mod playback;
pub mod store;
#[cfg(feature = "native-ui")]
pub mod ui;

pub const APP_ID: &str = "com.dogmedia.Desktop";
