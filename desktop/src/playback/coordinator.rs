use crate::domain::{Media, MediaId, Quality, SessionHolder};

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
    pub session_unavailable: bool,
    pub holder: Option<SessionHolder>,
    pub holder_retry_after: Option<u64>,
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
            session_unavailable: false,
            holder: None,
            holder_retry_after: None,
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
        media_id: MediaId,
    },
    CreateSession {
        media_id: MediaId,
        quality: Quality,
        position: f64,
    },
}

#[derive(Debug, Default, Clone)]
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
        self.snapshot.session_unavailable = false;
        self.snapshot.holder = None;
        self.snapshot.holder_retry_after = None;
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
        self.snapshot.session_unavailable = false;
        self.snapshot.holder = None;
        self.snapshot.holder_retry_after = None;
        true
    }

    pub fn loaded_paused(&mut self, sequence: u64, position: f64) -> bool {
        if sequence != self.snapshot.sequence {
            return false;
        }
        self.snapshot.position = position.max(0.0);
        self.snapshot.status = PlaybackStatus::Paused;
        self.snapshot.session_unavailable = false;
        self.snapshot.holder = None;
        self.snapshot.holder_retry_after = None;
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
            PlaybackStatus::Paused | PlaybackStatus::Ended | PlaybackStatus::Loading
        ) {
            self.snapshot.status = PlaybackStatus::Playing;
        }
    }

    pub fn pause(&mut self) {
        if matches!(
            self.snapshot.status,
            PlaybackStatus::Playing | PlaybackStatus::Loading
        ) {
            self.snapshot.status = PlaybackStatus::Paused;
        }
    }

    pub fn ended(&mut self) {
        self.snapshot.status = PlaybackStatus::Ended;
        self.snapshot.position = self.snapshot.duration;
    }

    pub fn lease_lost(&mut self) {
        self.snapshot.status = PlaybackStatus::Paused;
        self.snapshot.session_unavailable = true;
        self.snapshot.error = Some("Playback moved to another device".into());
    }

    pub fn session_unavailable(&mut self, message: impl Into<String>) {
        self.snapshot.status = PlaybackStatus::Paused;
        self.snapshot.session_unavailable = true;
        self.snapshot.error = Some(message.into());
    }

    /// Record who holds the exclusive lease (and when it expires) for the
    /// conflict card. Cleared together with `session_unavailable`.
    pub fn set_holder(&mut self, holder: Option<SessionHolder>, retry_after: Option<u64>) {
        self.snapshot.holder = holder;
        self.snapshot.holder_retry_after = retry_after;
    }

    pub fn remote_available(&mut self) {
        if self.snapshot.session_unavailable {
            self.snapshot.status = PlaybackStatus::Idle;
            self.snapshot.media = None;
            self.snapshot.position = 0.0;
            self.snapshot.duration = 0.0;
            self.snapshot.session_unavailable = false;
            self.snapshot.holder = None;
            self.snapshot.holder_retry_after = None;
        }
    }

    pub fn observe_remote(
        &mut self,
        media: Media,
        holder: SessionHolder,
        retry_after: Option<u64>,
    ) {
        let playback = holder.playback.as_ref();
        self.snapshot.sequence += 1;
        self.snapshot.media = Some(media);
        self.snapshot.position = playback.map_or(0.0, |value| value.position.max(0.0));
        self.snapshot.duration = playback.map_or_else(
            || {
                self.snapshot
                    .media
                    .as_ref()
                    .and_then(|value| value.duration)
                    .unwrap_or(0.0)
            },
            |value| value.duration.max(0.0),
        );
        self.snapshot.status = if playback.is_some_and(|value| value.action == "play") {
            PlaybackStatus::Playing
        } else {
            PlaybackStatus::Paused
        };
        self.snapshot.repeat = match playback.and_then(|value| value.loop_mode.as_deref()) {
            Some("media") => RepeatMode::One,
            Some("queue") => RepeatMode::Queue,
            _ => RepeatMode::None,
        };
        self.snapshot.shuffle = playback.is_some_and(|value| value.shuffle_enabled);
        self.snapshot.session_unavailable = true;
        self.snapshot.holder = Some(holder);
        self.snapshot.holder_retry_after = retry_after;
        self.snapshot.error = Some("Playback is active elsewhere".to_owned());
        self.released_sequence = Some(self.snapshot.sequence);
    }

    /// Position-query jitter below this is not a real movement. Tick callers
    /// must check `timing_changed` before taking a write guard: creating the
    /// guard alone marks the whole app signal dirty and re-renders 10x/s.
    pub const TIMING_EPSILON: f64 = 0.005;

    pub fn update_position(&mut self, position: f64) -> bool {
        if self.snapshot.session_unavailable {
            return false;
        }
        let position = position.max(0.0);
        if (self.snapshot.position - position).abs() < Self::TIMING_EPSILON {
            return false;
        }
        self.snapshot.position = position;
        true
    }

    pub fn timing_changed(&self, position: f64, duration: f64) -> bool {
        if self.snapshot.session_unavailable {
            return false;
        }
        (self.snapshot.position - position.max(0.0)).abs() >= Self::TIMING_EPSILON
            || (self.snapshot.duration - duration.max(0.0)).abs() >= Self::TIMING_EPSILON
    }

    pub fn update_timing(&mut self, position: f64, duration: f64) -> bool {
        if self.snapshot.session_unavailable {
            return false;
        }
        if !self.timing_changed(position, duration) {
            return false;
        }
        self.snapshot.position = position.max(0.0);
        self.snapshot.duration = duration.max(0.0);
        true
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

    pub fn set_liked(&mut self, liked: bool) {
        if let Some(media) = &mut self.snapshot.media {
            media.liked = liked;
        }
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
        self.snapshot.media = None;
        self.snapshot.position = 0.0;
        self.snapshot.duration = 0.0;
        self.snapshot.error = None;
        self.snapshot.session_unavailable = false;
        self.snapshot.holder = None;
        self.snapshot.holder_retry_after = None;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unchanged_timing_reports_no_change() {
        let mut coordinator = PlaybackCoordinator::default();
        assert!(coordinator.update_timing(10.0, 200.0));
        // Identical values and sub-epsilon jitter must not count as writes.
        assert!(!coordinator.timing_changed(10.0, 200.0));
        assert!(!coordinator.timing_changed(10.004, 200.004));
        assert!(!coordinator.update_timing(10.0, 200.0));
        assert_eq!(coordinator.snapshot().position, 10.0);
    }

    #[test]
    fn moved_timing_reports_change() {
        let mut coordinator = PlaybackCoordinator::default();
        assert!(coordinator.update_timing(10.0, 200.0));
        assert!(coordinator.timing_changed(10.5, 200.0));
        assert!(coordinator.timing_changed(10.0, 201.0));
        assert!(coordinator.update_timing(10.5, 200.0));
        assert_eq!(coordinator.snapshot().position, 10.5);
    }

    #[test]
    fn timing_clamps_negatives_and_ignores_unavailable_sessions() {
        let mut coordinator = PlaybackCoordinator::default();
        assert!(coordinator.update_timing(10.0, 200.0));
        assert!(coordinator.update_timing(-3.0, -1.0));
        assert_eq!(coordinator.snapshot().position, 0.0);
        assert_eq!(coordinator.snapshot().duration, 0.0);

        coordinator.snapshot.session_unavailable = true;
        assert!(!coordinator.timing_changed(99.0, 99.0));
        assert!(!coordinator.update_timing(99.0, 99.0));
        assert!(!coordinator.update_position(99.0));
    }

    #[test]
    fn update_position_gates_jitter_but_applies_seeks() {
        let mut coordinator = PlaybackCoordinator::default();
        assert!(coordinator.update_position(15.0));
        assert!(!coordinator.update_position(15.004));
        assert!(coordinator.update_position(90.0));
        assert_eq!(coordinator.snapshot().position, 90.0);
    }
}
