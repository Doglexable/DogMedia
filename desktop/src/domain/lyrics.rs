use serde::Deserialize;

use super::{StreamPath, SubtitleId};

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct LyricSegment {
    pub start: f64,
    #[serde(default)]
    pub end: Option<f64>,
    pub text: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct Lyrics {
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub segments: Vec<LyricSegment>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleTrack {
    pub id: SubtitleId,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    pub vtt_url: StreamPath,
    #[serde(default)]
    pub ass_url: Option<StreamPath>,
}

impl SubtitleTrack {
    pub fn preferred_url(&self) -> (&StreamPath, &'static str) {
        self.ass_url
            .as_ref()
            .map_or((&self.vtt_url, "vtt"), |url| (url, "ass"))
    }
}
