use crate::domain::{Media, Quality};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlaybackStatus {
    Idle,
    Loading,
    Playing,
    Paused,
    Ended,
    Failed,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum RepeatMode {
    #[default]
    None,
    One,
    Queue,
}

#[derive(Debug, Clone)]
pub struct PlaybackSnapshot {
    pub sequence: u64,
    pub status: PlaybackStatus,
    pub media: Option<Media>,
    pub position: f64,
    pub duration: f64,
    pub quality: Quality,
    pub repeat: RepeatMode,
    pub shuffle: bool,
    pub error: Option<String>,
}

impl Default for PlaybackSnapshot {
    fn default() -> Self {
        Self {
            sequence: 0,
            status: PlaybackStatus::Idle,
            media: None,
            position: 0.0,
            duration: 0.0,
            quality: Quality::High,
            repeat: RepeatMode::None,
            shuffle: false,
            error: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Effect {
    PersistProgress,
    StopPipeline,
    ReleaseLease,
    DisplayPhoto {
        media_id: i64,
    },
    CreateSession {
        media_id: i64,
        quality: Quality,
        position: f64,
    },
}

#[derive(Debug, Default)]
pub struct PlaybackCoordinator {
    snapshot: PlaybackSnapshot,
    released_sequence: Option<u64>,
}

impl PlaybackCoordinator {
    pub fn snapshot(&self) -> &PlaybackSnapshot {
        &self.snapshot
    }

    pub fn load(&mut self, media: Media) -> Vec<Effect> {
        let mut effects = Vec::new();
        if self.snapshot.media.is_some() {
            effects.extend([
                Effect::PersistProgress,
                Effect::StopPipeline,
                Effect::ReleaseLease,
            ]);
        }
        self.snapshot.sequence += 1;
        self.snapshot.status = PlaybackStatus::Loading;
        self.snapshot.position = 0.0;
        self.snapshot.duration = media.duration.unwrap_or(0.0);
        self.snapshot.error = None;
        let media_id = media.id;
        self.snapshot.media = Some(media);
        self.released_sequence = None;
        if self.snapshot.media.as_ref().is_some_and(Media::is_photo) {
            effects.push(Effect::DisplayPhoto { media_id });
        } else {
            effects.push(Effect::CreateSession {
                media_id,
                quality: self.snapshot.quality,
                position: 0.0,
            });
        }
        effects
    }

    pub fn loaded(&mut self, sequence: u64, position: f64) -> bool {
        if sequence != self.snapshot.sequence {
            return false;
        }
        self.snapshot.position = position.max(0.0);
        self.snapshot.status = PlaybackStatus::Playing;
        true
    }

    pub fn failed(&mut self, sequence: u64, message: impl Into<String>) -> bool {
        if sequence != self.snapshot.sequence {
            return false;
        }
        self.snapshot.status = PlaybackStatus::Failed;
        self.snapshot.error = Some(message.into());
        true
    }

    pub fn play(&mut self) {
        if matches!(
            self.snapshot.status,
            PlaybackStatus::Paused | PlaybackStatus::Ended
        ) {
            self.snapshot.status = PlaybackStatus::Playing;
        }
    }

    pub fn pause(&mut self) {
        if self.snapshot.status == PlaybackStatus::Playing {
            self.snapshot.status = PlaybackStatus::Paused;
        }
    }

    pub fn ended(&mut self) {
        self.snapshot.status = PlaybackStatus::Ended;
        self.snapshot.position = self.snapshot.duration;
    }

    pub fn lease_lost(&mut self) {
        self.snapshot.status = PlaybackStatus::Paused;
        self.snapshot.error = Some("Playback moved to another device".into());
    }

    pub fn update_position(&mut self, position: f64) {
        self.snapshot.position = position.max(0.0);
    }

    pub fn update_timing(&mut self, position: f64, duration: f64) {
        self.snapshot.position = position.max(0.0);
        self.snapshot.duration = duration.max(0.0);
    }

    pub fn set_quality(&mut self, quality: Quality) -> Option<Effect> {
        if self.snapshot.quality == quality {
            return None;
        }
        self.snapshot.quality = quality;
        self.snapshot
            .media
            .as_ref()
            .map(|media| Effect::CreateSession {
                media_id: media.id,
                quality,
                position: self.snapshot.position,
            })
    }

    pub fn set_repeat(&mut self, repeat: RepeatMode) {
        self.snapshot.repeat = repeat;
    }

    pub fn set_shuffle(&mut self, shuffle: bool) {
        self.snapshot.shuffle = shuffle;
    }

    pub fn stop(&mut self) -> Vec<Effect> {
        if self.snapshot.status == PlaybackStatus::Idle {
            return Vec::new();
        }
        let mut effects = vec![Effect::PersistProgress, Effect::StopPipeline];
        if self.released_sequence != Some(self.snapshot.sequence) {
            effects.push(Effect::ReleaseLease);
            self.released_sequence = Some(self.snapshot.sequence);
        }
        self.snapshot.status = PlaybackStatus::Idle;
        effects
    }

    pub fn next_index(&self, current: usize, length: usize) -> Option<usize> {
        if length == 0 {
            return None;
        }
        match self.snapshot.repeat {
            RepeatMode::One => Some(current.min(length - 1)),
            RepeatMode::Queue if current + 1 >= length => Some(0),
            _ if current + 1 < length => Some(current + 1),
            _ => None,
        }
    }
}
