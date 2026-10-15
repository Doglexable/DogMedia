mod app_menubar;
mod featured;
mod full_player;
mod library;
mod lyrics_share;
mod player_bar;
mod queue_panel;
mod settings_dialog;
mod shell;
mod sidebar;
mod video_mini_player;
mod video_player;

pub(crate) use app_menubar::AppMenubar;
pub(crate) use featured::Featured;
pub(crate) use full_player::FullPlayer;
pub(crate) use library::Library;
pub(crate) use lyrics_share::LyricsShareDialog;
#[cfg(test)]
pub(crate) use player_bar::can_take_over_playback;
pub(crate) use player_bar::{PlayerBar, QualityOverlay, QualityPopover, SessionConflictCard};
pub(crate) use queue_panel::QueuePanel;
pub(crate) use settings_dialog::{ConnectionErrorDialog, SettingsDialog};
pub(crate) use shell::Shell;
pub(crate) use sidebar::Sidebar;
#[cfg(test)]
pub(crate) use sidebar::{category_has_media, truncate_category_name};
pub(crate) use video_mini_player::VideoMiniPlayer;
pub(crate) use video_player::VideoPlayer;
