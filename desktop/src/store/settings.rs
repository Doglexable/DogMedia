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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ServerEnvironment {
    Local,
    Staging,
    Prod,
}

impl ServerEnvironment {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Local => "Local",
            Self::Staging => "Staging",
            Self::Prod => "Prod",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServerEnvironmentUrls {
    pub local: String,
    pub staging: String,
    pub prod: String,
}

impl Default for ServerEnvironmentUrls {
    fn default() -> Self {
        Self {
            local: "http://127.0.0.1:3000/".to_owned(),
            staging: "https://staging.dogmedia.example.com/".to_owned(),
            prod: "https://stream.dogmedia.example.com/".to_owned(),
        }
    }
}

impl ServerEnvironmentUrls {
    pub fn default_environment() -> ServerEnvironment {
        if cfg!(debug_assertions) {
            ServerEnvironment::Local
        } else {
            ServerEnvironment::Prod
        }
    }

    pub fn load() -> Self {
        let mut local = None;
        let mut staging = None;
        let mut prod = None;

        Self::check_env(&mut local, &mut staging, &mut prod);

        if local.is_none() || staging.is_none() || prod.is_none() {
            let search_paths = [
                PathBuf::from(".env"),
                PathBuf::from("../.env"),
                PathBuf::from("../../.env"),
            ];
            for path in &search_paths {
                if let Ok(content) = fs::read_to_string(path) {
                    Self::parse_env_content(&content, &mut local, &mut staging, &mut prod);
                    if local.is_some() && staging.is_some() && prod.is_some() {
                        break;
                    }
                }
            }
        }

        let defaults = Self::default();
        Self {
            local: local.unwrap_or(defaults.local),
            staging: staging.unwrap_or(defaults.staging),
            prod: prod.unwrap_or(defaults.prod),
        }
    }

    fn check_env(
        local: &mut Option<String>,
        staging: &mut Option<String>,
        prod: &mut Option<String>,
    ) {
        if local.is_none() {
            *local = std::env::var("DOGMEDIA_SERVER_URL_LOCAL")
                .or_else(|_| std::env::var("PFS_SERVER_URL_LOCAL"))
                .or_else(|_| std::env::var("SERVER_URL_LOCAL"))
                .ok();
        }
        if staging.is_none() {
            *staging = std::env::var("DOGMEDIA_SERVER_URL_STAGING")
                .or_else(|_| std::env::var("PFS_SERVER_URL_STAGING"))
                .or_else(|_| std::env::var("SERVER_URL_STAGING"))
                .ok();
        }
        if prod.is_none() {
            *prod = std::env::var("DOGMEDIA_SERVER_URL_PROD")
                .or_else(|_| std::env::var("PFS_SERVER_URL_PROD"))
                .or_else(|_| std::env::var("SERVER_URL_PROD"))
                .ok();
        }
    }

    pub fn parse_env_content(
        content: &str,
        local: &mut Option<String>,
        staging: &mut Option<String>,
        prod: &mut Option<String>,
    ) {
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((key, val)) = line.split_once('=') {
                let key = key.trim();
                let val = val.trim().trim_matches('"').trim_matches('\'').trim();
                if val.is_empty() {
                    continue;
                }
                match key {
                    "DOGMEDIA_SERVER_URL_LOCAL" | "PFS_SERVER_URL_LOCAL" | "SERVER_URL_LOCAL" => {
                        if local.is_none() {
                            *local = Some(val.to_owned());
                        }
                    }
                    "DOGMEDIA_SERVER_URL_STAGING"
                    | "PFS_SERVER_URL_STAGING"
                    | "SERVER_URL_STAGING" => {
                        if staging.is_none() {
                            *staging = Some(val.to_owned());
                        }
                    }
                    "DOGMEDIA_SERVER_URL_PROD" | "PFS_SERVER_URL_PROD" | "SERVER_URL_PROD" => {
                        if prod.is_none() {
                            *prod = Some(val.to_owned());
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    pub fn url_for(&self, env: ServerEnvironment) -> &str {
        match env {
            ServerEnvironment::Local => &self.local,
            ServerEnvironment::Staging => &self.staging,
            ServerEnvironment::Prod => &self.prod,
        }
    }

    pub fn match_environment(&self, url: &str) -> Option<ServerEnvironment> {
        let clean = url.trim().trim_end_matches('/');
        if !clean.is_empty() && clean == self.local.trim().trim_end_matches('/') {
            Some(ServerEnvironment::Local)
        } else if !clean.is_empty() && clean == self.staging.trim().trim_end_matches('/') {
            Some(ServerEnvironment::Staging)
        } else if !clean.is_empty() && clean == self.prod.trim().trim_end_matches('/') {
            Some(ServerEnvironment::Prod)
        } else {
            None
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EqSettings {
    pub enabled: bool,
    pub preset: String,
    pub gains: [f64; 10],
    pub target_db: f64,
}

impl Default for EqSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            preset: "flat".to_owned(),
            gains: [0.0; 10],
            target_db: 0.0,
        }
    }
}

impl EqSettings {
    pub const BAND_LABELS: [&'static str; 10] = [
        "31Hz", "62Hz", "125Hz", "250Hz", "500Hz", "1kHz", "2kHz", "4kHz", "8kHz", "16kHz",
    ];

    pub fn preset_gains(preset: &str) -> Option<[f64; 10]> {
        match preset.to_lowercase().as_str() {
            "flat" => Some([0.0; 10]),
            "dialogue" | "movie" => Some([-4.0, -2.0, 1.0, -1.0, 1.0, 3.0, 6.0, 4.0, 1.0, -2.0]),
            "rock" => Some([3.0, 5.0, 3.0, 0.0, 3.0, 5.0, 5.0, 3.0, 2.0, 0.0]),
            "pop" => Some([2.0, 3.0, 2.0, 0.0, 2.0, 3.0, 5.0, 5.0, 3.0, 2.0]),
            "electronic" => Some([8.0, 6.0, 3.0, -2.0, -2.0, 0.0, 3.0, 5.0, 6.0, 6.0]),
            "metal" => Some([6.0, 8.0, 5.0, -2.0, -5.0, -3.0, 2.0, 5.0, 8.0, 6.0]),
            "poprock" | "pop rock" => Some([5.0, 6.0, 3.0, 0.0, -2.0, 2.0, 3.0, 6.0, 5.0, 3.0]),
            "funk" => Some([5.0, 8.0, 6.0, 2.0, 0.0, 2.0, 3.0, 5.0, 6.0, 5.0]),
            "dreampop" | "dream pop" => Some([3.0, 3.0, 2.0, 0.0, 0.0, 2.0, 3.0, 5.0, 6.0, 6.0]),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub version: u8,
    pub configured: bool,
    pub server_url: ServerUrl,
    pub account_token: String,
    pub username: String,
    pub viewer_id: ViewerId,
    pub quality: Quality,
    pub volume: Volume,
    pub color_scheme: ColorScheme,
    pub notifications: bool,
    pub window_width: i32,
    pub window_height: i32,
    pub window_maximized: bool,
    pub local_folder: Option<PathBuf>,
    pub eq: EqSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: VERSION,
            configured: false,
            server_url: ServerUrl::default(),
            account_token: String::new(),
            username: String::new(),
            viewer_id: ViewerId::new(Uuid::new_v4().to_string()),
            quality: Quality::High,
            volume: Volume::default(),
            color_scheme: ColorScheme::System,
            notifications: true,
            window_width: 1280,
            window_height: 800,
            window_maximized: false,
            local_folder: None,
            eq: EqSettings::default(),
        }
    }
}

impl Settings {
    /// Checks persisted window geometry without mutating reactive app state.
    pub fn window_geometry_changed(
        &self,
        is_maximized: bool,
        is_fullscreen: bool,
        width: i32,
        height: i32,
    ) -> bool {
        if is_fullscreen {
            return false;
        }
        self.window_maximized != is_maximized
            || (!is_maximized
                && (self.window_width != width.max(800) || self.window_height != height.max(560)))
    }

    /// Updates window size and maximized state if changed, ignoring video fullscreen.
    /// Returns `true` if any persisted geometry field changed.
    pub fn update_window_geometry(
        &mut self,
        is_maximized: bool,
        is_fullscreen: bool,
        width: i32,
        height: i32,
    ) -> bool {
        if !self.window_geometry_changed(is_maximized, is_fullscreen, width, height) {
            return false;
        }
        self.window_maximized = is_maximized;
        if !is_maximized {
            self.window_width = width.max(800);
            self.window_height = height.max(560);
        }
        true
    }

    /// Returns `true` when the URL uses plain HTTP toward a public/non-local
    /// host and therefore needs explicit confirmation.
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
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(fs::Permissions::from_mode(0o600))?;
        }
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

pub fn artwork_cache_path(key: &str, extension: &str) -> Result<PathBuf, SettingsError> {
    let directory = project_dirs()?.cache_dir().join("artwork");
    fs::create_dir_all(&directory)?;
    let safe_name = key.replace([':', '/', '\\', ' '], "_");
    Ok(directory.join(format!("{safe_name}.{extension}")))
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
    fn old_settings_load_without_a_local_folder() {
        let mut value = serde_json::to_value(Settings::default()).unwrap();
        value.as_object_mut().unwrap().remove("local_folder");
        let loaded: Settings = serde_json::from_value(value).unwrap();
        assert!(loaded.local_folder.is_none());
    }

    #[test]
    fn local_http_is_accepted_but_public_http_requires_confirmation() {
        let mut settings = Settings::default();
        assert!(!settings.set_server_url("http://192.168.1.8:3001").unwrap());
        assert!(!settings.set_server_url("http://localhost:3001").unwrap());
        assert!(
            settings
                .set_server_url("http://media.example.test")
                .unwrap()
        );
    }

    #[test]
    fn server_environment_urls_parses_env_content_and_matches() {
        let env_content = r#"
            # Server config
            DOGMEDIA_SERVER_URL_LOCAL="http://127.0.0.1:3000/"
            DOGMEDIA_SERVER_URL_STAGING=https://staging.example.com
            DOGMEDIA_SERVER_URL_PROD='https://stream.example.com/'
        "#;
        let mut local = None;
        let mut staging = None;
        let mut prod = None;
        ServerEnvironmentUrls::parse_env_content(env_content, &mut local, &mut staging, &mut prod);
        assert_eq!(local.as_deref(), Some("http://127.0.0.1:3000/"));
        assert_eq!(staging.as_deref(), Some("https://staging.example.com"));
        assert_eq!(prod.as_deref(), Some("https://stream.example.com/"));

        let urls = ServerEnvironmentUrls {
            local: local.unwrap(),
            staging: staging.unwrap(),
            prod: prod.unwrap(),
        };

        assert_eq!(urls.match_environment("http://127.0.0.1:3000"), Some(ServerEnvironment::Local));
        assert_eq!(urls.match_environment("http://127.0.0.1:3000/"), Some(ServerEnvironment::Local));
        assert_eq!(urls.match_environment("https://staging.example.com/"), Some(ServerEnvironment::Staging));
        assert_eq!(urls.match_environment("https://stream.example.com"), Some(ServerEnvironment::Prod));
        assert_eq!(urls.match_environment("https://other.com"), None);
    }

    #[test]
    fn old_settings_load_without_window_maximized() {
        let mut value = serde_json::to_value(Settings::default()).unwrap();
        value.as_object_mut().unwrap().remove("window_maximized");
        let loaded: Settings = serde_json::from_value(value).unwrap();
        assert!(!loaded.window_maximized);
        assert_eq!(loaded.window_width, 1280);
        assert_eq!(loaded.window_height, 800);
    }

    #[test]
    fn window_geometry_updates_and_ignores_fullscreen() {
        let mut settings = Settings::default();
        assert_eq!(settings.window_width, 1280);
        assert_eq!(settings.window_height, 800);
        assert!(!settings.window_maximized);

        // Ignores video fullscreen
        assert!(!settings.window_geometry_changed(true, true, 1920, 1080));
        assert!(!settings.update_window_geometry(true, true, 1920, 1080));
        assert!(!settings.window_maximized);
        assert_eq!(settings.window_width, 1280);

        // Normal resize
        assert!(settings.window_geometry_changed(false, false, 1440, 900));
        assert!(settings.update_window_geometry(false, false, 1440, 900));
        assert_eq!(settings.window_width, 1440);
        assert_eq!(settings.window_height, 900);
        assert!(!settings.window_maximized);

        // Same dimensions report no change
        assert!(!settings.window_geometry_changed(false, false, 1440, 900));
        assert!(!settings.update_window_geometry(false, false, 1440, 900));

        // Maximize window (preserves width/height for unmaximize)
        assert!(settings.window_geometry_changed(true, false, 1920, 1080));
        assert!(settings.update_window_geometry(true, false, 1920, 1080));
        assert!(settings.window_maximized);
        assert_eq!(settings.window_width, 1440);
        assert_eq!(settings.window_height, 900);

        // Unmaximize restores
        assert!(settings.update_window_geometry(false, false, 1440, 900));
        assert!(!settings.window_maximized);
        assert_eq!(settings.window_width, 1440);
    }

    #[test]
    fn old_settings_load_without_eq_settings() {
        let mut value = serde_json::to_value(Settings::default()).unwrap();
        value.as_object_mut().unwrap().remove("eq");
        let loaded: Settings = serde_json::from_value(value).unwrap();
        assert_eq!(loaded.eq, EqSettings::default());
        assert!(!loaded.eq.enabled);
        assert_eq!(loaded.eq.preset, "flat");
    }

    #[test]
    fn eq_presets_resolve_known_gain_curves() {
        assert_eq!(EqSettings::preset_gains("flat"), Some([0.0; 10]));
        assert_eq!(
            EqSettings::preset_gains("rock"),
            Some([3.0, 5.0, 3.0, 0.0, 3.0, 5.0, 5.0, 3.0, 2.0, 0.0])
        );
        assert_eq!(
            EqSettings::preset_gains("dialogue"),
            Some([-4.0, -2.0, 1.0, -1.0, 1.0, 3.0, 6.0, 4.0, 1.0, -2.0])
        );
        assert_eq!(EqSettings::preset_gains("unknown_preset"), None);
    }
}
