use std::{fmt, str::FromStr};

use serde::{Deserialize, Serialize};

use super::{MediaId, SessionId, StreamPath, ViewerId};

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
    pub const ALL: [Self; 4] = [Self::Low, Self::Med, Self::High, Self::Ori];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Med => "med",
            Self::High => "high",
            Self::Ori => "ori",
        }
    }
}

impl fmt::Display for Quality {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Low => "Low",
            Self::Med => "Medium",
            Self::High => "High",
            Self::Ori => "Original",
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QualityParseError;

impl fmt::Display for QualityParseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("unknown quality (expected low, med, high or ori)")
    }
}

impl std::error::Error for QualityParseError {}

impl FromStr for Quality {
    type Err = QualityParseError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "low" | "Low" => Ok(Self::Low),
            "med" | "Medium" => Ok(Self::Med),
            "high" | "High" => Ok(Self::High),
            "ori" | "Original" => Ok(Self::Ori),
            _ => Err(QualityParseError),
        }
    }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSession {
    pub stream_url: StreamPath,
    pub session_id: SessionId,
    pub viewer_id: ViewerId,
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
    pub media_id: MediaId,
    pub action: &'a str,
    pub position: f64,
    pub duration: f64,
    pub media_type: &'a str,
    pub title: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artists: Option<&'a str>,
    pub source: &'a str,
}

/// Playback volume in `0.0..=1.0`, clamped at construction.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Volume(f64);

impl Volume {
    pub const DEFAULT: Self = Self(0.8);

    pub fn new(value: f64) -> Self {
        Self(value.clamp(0.0, 1.0))
    }

    pub fn get(self) -> f64 {
        self.0
    }
}

impl Default for Volume {
    fn default() -> Self {
        Self::DEFAULT
    }
}
