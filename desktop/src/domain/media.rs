use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaFilter {
    #[default]
    All,
    Audio,
    Video,
    Photo,
}

impl MediaFilter {
    pub const fn as_query(self) -> &'static str {
        match self {
            Self::All => "all",
            Self::Audio => "audio",
            Self::Video => "video",
            Self::Photo => "photo",
        }
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct Media {
    pub id: i64,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub artists: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub mime_type: Option<String>,
    #[serde(default)]
    pub category_id: Option<i64>,
    #[serde(default)]
    pub category_name: Option<String>,
    #[serde(default)]
    pub category_path: Option<String>,
    #[serde(default)]
    pub artwork_version: Option<String>,
    #[serde(default)]
    pub liked: bool,
    #[serde(default)]
    pub source_version: Option<i64>,
}

impl Media {
    pub fn title(&self) -> &str {
        self.title.as_deref().unwrap_or("Untitled")
    }

    pub fn subtitle(&self) -> &str {
        self.artists
            .as_deref()
            .or(self.category_name.as_deref())
            .unwrap_or("")
    }

    pub fn is_audio(&self) -> bool {
        self.mime_type
            .as_deref()
            .is_some_and(|value| value.starts_with("audio/"))
    }

    pub fn is_video(&self) -> bool {
        self.mime_type
            .as_deref()
            .is_some_and(|value| value.starts_with("video/"))
    }

    pub fn is_photo(&self) -> bool {
        self.mime_type
            .as_deref()
            .is_some_and(|value| value.starts_with("image/"))
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowsePage {
    #[serde(default)]
    pub items: Vec<Media>,
    #[serde(default)]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BrowseQuery {
    pub search: String,
    pub media_type: MediaFilter,
    pub category_id: Option<i64>,
    pub liked: bool,
    pub cursor: Option<String>,
    pub limit: u8,
}
