use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

use crate::api::{ServerUrl, ServerUrlError};
use crate::domain::{MediaId, Quality, SubtitleId, ViewerId, Volume};

const VERSION: u8 = 1;

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ColorScheme {
    Light,
    Dark,
    #[default]
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub version: u8,
    pub configured: bool,
    pub server_url: ServerUrl,
    pub viewer_id: ViewerId,
    pub quality: Quality,
    pub volume: Volume,
    pub color_scheme: ColorScheme,
    pub notifications: bool,
    pub window_width: i32,
    pub window_height: i32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: VERSION,
            configured: false,
            server_url: ServerUrl::default(),
            viewer_id: ViewerId::new(Uuid::new_v4().to_string()),
            quality: Quality::High,
            volume: Volume::default(),
            color_scheme: ColorScheme::System,
            notifications: true,
            window_width: 1100,
            window_height: 720,
        }
    }
}

impl Settings {
    /// Returns `true` when the URL uses plain HTTP toward a non-loopback host
    /// and therefore needs an explicit trusted-LAN confirmation.
    pub fn set_server_url(&mut self, input: &str) -> Result<bool, SettingsError> {
        let parsed = ServerUrl::parse(input)?;
        let insecure = parsed.is_insecure_remote();
        self.server_url = parsed;
        self.configured = true;
        Ok(insecure)
    }
}

#[derive(Debug, Error)]
pub enum SettingsError {
    #[error("unable to locate an XDG application directory")]
    NoApplicationDirectory,
    #[error("invalid server URL: {0}")]
    InvalidUrl(#[from] ServerUrlError),
    #[error("settings I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("settings are malformed: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone)]
pub struct SettingsStore {
    path: PathBuf,
}

impl SettingsStore {
    pub fn discover() -> Result<Self, SettingsError> {
        let directories = project_dirs()?;
        Ok(Self {
            path: directories.config_dir().join("settings.json"),
        })
    }

    pub fn at(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    pub fn load(&self) -> Result<Settings, SettingsError> {
        match fs::read(&self.path) {
            Ok(bytes) => {
                let settings: Settings = serde_json::from_slice(&bytes)?;
                Ok(if settings.version == VERSION {
                    settings
                } else {
                    Settings::default()
                })
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
            Err(error) => Err(error.into()),
        }
    }

    pub fn save(&self, settings: &Settings) -> Result<(), SettingsError> {
        let parent = self.path.parent().unwrap_or_else(|| Path::new("."));
        fs::create_dir_all(parent)?;
        let temporary = self.path.with_extension("json.tmp");
        let mut file = fs::File::create(&temporary)?;
        file.write_all(&serde_json::to_vec_pretty(settings)?)?;
        file.sync_all()?;
        fs::rename(temporary, &self.path)?;
        Ok(())
    }
}

pub fn subtitle_cache_path(
    media_id: MediaId,
    subtitle_id: SubtitleId,
    extension: &str,
) -> Result<PathBuf, SettingsError> {
    let directory = project_dirs()?
        .cache_dir()
        .join("subtitles")
        .join(media_id.to_string());
    fs::create_dir_all(&directory)?;
    Ok(directory.join(format!("{subtitle_id}.{extension}")))
}

fn project_dirs() -> Result<ProjectDirs, SettingsError> {
    ProjectDirs::from("com", "dogmedia", "Desktop").ok_or(SettingsError::NoApplicationDirectory)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_persist_server_and_viewer_identity() {
        let directory = tempfile::tempdir().unwrap();
        let store = SettingsStore::at(directory.path().join("settings.json"));
        let mut settings = Settings::default();
        settings
            .set_server_url("https://example.test/media")
            .unwrap();
        let viewer = settings.viewer_id.clone();
        store.save(&settings).unwrap();
        let loaded = store.load().unwrap();
        assert!(loaded.configured);
        assert_eq!(loaded.viewer_id, viewer);
        assert_eq!(loaded.server_url.to_string(), "https://example.test/media/");
    }

    #[test]
    fn insecure_lan_url_requires_confirmation() {
        let mut settings = Settings::default();
        assert!(settings.set_server_url("http://192.168.1.8:3001").unwrap());
        assert!(!settings.set_server_url("http://localhost:3001").unwrap());
    }
}
