use std::fmt;

use serde::{Deserialize, Serialize};

use super::{CategoryId, Cursor, Limit, MediaId, Quality};

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
    pub const ALL: [Self; 4] = [Self::All, Self::Audio, Self::Video, Self::Photo];

    pub const fn as_query(self) -> &'static str {
        match self {
            Self::All => "all",
            Self::Audio => "audio",
            Self::Video => "video",
            Self::Photo => "photo",
        }
    }
}
impl fmt::Display for MediaFilter {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::All => "All media",
            Self::Audio => "Audio",
            Self::Video => "Video",
            Self::Photo => "Photos",
        })
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct Media {
    pub id: MediaId,
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
    pub category_id: Option<CategoryId>,
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
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub available_qualities: Option<Vec<Quality>>,
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

    pub fn supports_quality(&self, quality: Quality) -> bool {
        self.available_qualities
            .as_ref()
            .is_none_or(|available| available.contains(&quality))
    }

    pub fn playable_quality(&self, preferred: Quality) -> Quality {
        let Some(available) = &self.available_qualities else {
            return preferred;
        };
        if available.contains(&preferred) || available.is_empty() {
            return preferred;
        }
        if preferred == Quality::Ori {
            return [Quality::High, Quality::Med, Quality::Low]
                .into_iter()
                .find(|quality| available.contains(quality))
                .unwrap_or(preferred);
        }
        let tiers = [Quality::Low, Quality::Med, Quality::High];
        let index = tiers
            .iter()
            .position(|quality| *quality == preferred)
            .unwrap_or(0);
        tiers[..index]
            .iter()
            .rev()
            .chain(tiers[index + 1..].iter())
            .copied()
            .find(|quality| available.contains(quality))
            .or_else(|| available.contains(&Quality::Ori).then_some(Quality::Ori))
            .unwrap_or(preferred)
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowsePage {
    #[serde(default)]
    pub items: Vec<Media>,
    #[serde(default)]
    pub next_cursor: Option<Cursor>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BrowseQuery {
    pub search: String,
    pub media_type: MediaFilter,
    pub category_id: Option<CategoryId>,
    pub liked: bool,
    pub cursor: Option<Cursor>,
    pub limit: Limit,
}

impl BrowseQuery {
    /// Render the `api/media/browse` query string. Unit-testable without HTTP.
    pub fn query_string(&self) -> String {
        let mut pairs = url::form_urlencoded::Serializer::new(String::new());
        pairs.append_pair("limit", &self.limit.get().to_string());
        pairs.append_pair("type", self.media_type.as_query());
        if !self.search.trim().is_empty() {
            pairs.append_pair("q", self.search.trim());
        }
        if let Some(category_id) = self.category_id {
            pairs.append_pair("category_id", &category_id.to_string());
        }
        if self.liked {
            pairs.append_pair("view", "liked");
        }
        if let Some(cursor) = &self.cursor {
            pairs.append_pair("cursor", cursor.as_str());
        }
        pairs.finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_string_encodes_filters_without_http() {
        let query = BrowseQuery {
            search: "a & b".into(),
            media_type: MediaFilter::Audio,
            category_id: Some(CategoryId::new(7)),
            liked: true,
            cursor: Some(Cursor::from("before/after")),
            limit: Limit::new(50),
        };
        let pairs: std::collections::HashMap<_, _> =
            url::form_urlencoded::parse(query.query_string().as_bytes())
                .into_owned()
                .collect();
        assert_eq!(pairs["limit"], "50");
        assert_eq!(pairs["type"], "audio");
        assert_eq!(pairs["q"], "a & b");
        assert_eq!(pairs["category_id"], "7");
        assert_eq!(pairs["view"], "liked");
        assert_eq!(pairs["cursor"], "before/after");
    }

    #[test]
    fn query_string_omits_empty_filters() {
        let pairs: std::collections::HashMap<_, _> =
            url::form_urlencoded::parse(BrowseQuery::default().query_string().as_bytes())
                .into_owned()
                .collect();
        assert_eq!(pairs.len(), 2);
        assert_eq!(pairs["type"], "all");
    }

    #[test]
    fn media_accepts_the_server_added_timestamp() {
        let media: Media = serde_json::from_value(serde_json::json!({
            "id": 9,
            "created_at": "2026-09-29T12:30:00.000Z"
        }))
        .unwrap();

        assert_eq!(
            media.created_at.as_deref(),
            Some("2026-09-29T12:30:00.000Z")
        );
    }

    #[test]
    fn quality_choices_follow_available_renditions() {
        let media: Media = serde_json::from_value(serde_json::json!({
            "id": 9,
            "available_qualities": ["low", "med"]
        }))
        .unwrap();
        assert!(media.supports_quality(Quality::Med));
        assert!(!media.supports_quality(Quality::High));
        assert_eq!(media.playable_quality(Quality::High), Quality::Med);
        assert_eq!(media.playable_quality(Quality::Ori), Quality::Med);
        assert_eq!(media.playable_quality(Quality::Low), Quality::Low);
    }
}
