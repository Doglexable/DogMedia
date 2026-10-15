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

pub const MIN_INSTRUMENTAL_GAP_SECONDS: f64 = 3.0;

#[derive(Debug, Clone, PartialEq)]
pub struct DisplayLyricSegment {
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub instrumental: bool,
}

pub fn build_lyrics_display_segments(segments: &[LyricSegment]) -> Vec<DisplayLyricSegment> {
    if segments.is_empty() {
        return Vec::new();
    }
    let mut display = Vec::new();
    let first_start = segments[0].start;
    if first_start >= MIN_INSTRUMENTAL_GAP_SECONDS {
        display.push(DisplayLyricSegment {
            start: 0.0,
            end: first_start,
            text: "Instrumental".to_string(),
            instrumental: true,
        });
    }
    for (i, seg) in segments.iter().enumerate() {
        let end = seg.end.unwrap_or(seg.start + 5.0);
        display.push(DisplayLyricSegment {
            start: seg.start,
            end,
            text: seg.text.clone(),
            instrumental: false,
        });
        if let Some(next) = segments.get(i + 1) {
            if next.start - end >= MIN_INSTRUMENTAL_GAP_SECONDS {
                display.push(DisplayLyricSegment {
                    start: end,
                    end: next.start,
                    text: "Instrumental".to_string(),
                    instrumental: true,
                });
            }
        }
    }
    display
}

pub fn find_active_lyrics_index(segments: &[DisplayLyricSegment], position: f64) -> Option<usize> {
    segments
        .iter()
        .position(|seg| position >= seg.start && position < seg.end)
}

pub fn find_lyrics_focus_index(segments: &[DisplayLyricSegment], position: f64) -> usize {
    if segments.is_empty() {
        return 0;
    }
    if let Some(active) = find_active_lyrics_index(segments, position) {
        return active;
    }
    for (i, seg) in segments.iter().enumerate().rev() {
        if position >= seg.start {
            return i;
        }
    }
    0
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_lyrics_display_segments_inserts_instrumentals() {
        let segments = vec![
            LyricSegment {
                start: 10.0,
                end: Some(15.0),
                text: "First line".to_string(),
            },
            LyricSegment {
                start: 25.0,
                end: Some(30.0),
                text: "Second line after solo".to_string(),
            },
        ];
        let display = build_lyrics_display_segments(&segments);
        assert_eq!(display.len(), 4);
        assert_eq!(display[0].text, "Instrumental");
        assert!(display[0].instrumental);
        assert_eq!(display[0].start, 0.0);
        assert_eq!(display[0].end, 10.0);

        assert_eq!(display[1].text, "First line");
        assert!(!display[1].instrumental);

        assert_eq!(display[2].text, "Instrumental");
        assert!(display[2].instrumental);
        assert_eq!(display[2].start, 15.0);
        assert_eq!(display[2].end, 25.0);

        assert_eq!(display[3].text, "Second line after solo");
        assert!(!display[3].instrumental);
    }

    #[test]
    fn find_active_and_focus_lyrics_index() {
        let segments = vec![
            DisplayLyricSegment {
                start: 0.0,
                end: 10.0,
                text: "Intro".to_string(),
                instrumental: true,
            },
            DisplayLyricSegment {
                start: 10.0,
                end: 20.0,
                text: "Verse 1".to_string(),
                instrumental: false,
            },
        ];
        assert_eq!(find_active_lyrics_index(&segments, 5.0), Some(0));
        assert_eq!(find_active_lyrics_index(&segments, 15.0), Some(1));
        assert_eq!(find_active_lyrics_index(&segments, 25.0), None);

        assert_eq!(find_lyrics_focus_index(&segments, 5.0), 0);
        assert_eq!(find_lyrics_focus_index(&segments, 15.0), 1);
        assert_eq!(find_lyrics_focus_index(&segments, 25.0), 1);
    }
}
