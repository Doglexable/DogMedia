use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Quality {
    Low,
    Med,
    #[default]
    High,
    Ori,
}

impl Quality {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Med => "med",
            Self::High => "high",
            Self::Ori => "ori",
        }
    }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSession {
    pub stream_url: String,
    pub session_id: String,
    pub viewer_id: String,
    #[serde(default)]
    pub lease_required: bool,
    pub quality: Quality,
    #[serde(default)]
    pub expires_at: Option<String>,
}

impl std::fmt::Debug for PlaybackSession {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PlaybackSession")
            .field("stream_url", &self.stream_url)
            .field("session_id", &"[redacted]")
            .field("viewer_id", &"[redacted]")
            .field("lease_required", &self.lease_required)
            .field("quality", &self.quality)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, Deserialize, Default, PartialEq)]
pub struct ResumePosition {
    #[serde(default)]
    pub position: Option<f64>,
    #[serde(default)]
    pub duration: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackReport<'a> {
    pub media_id: i64,
    pub action: &'a str,
    pub position: f64,
    pub duration: f64,
    pub media_type: &'a str,
    pub title: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artists: Option<&'a str>,
    pub source: &'a str,
}
