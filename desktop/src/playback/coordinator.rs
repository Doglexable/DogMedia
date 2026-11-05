use std::time::{Duration, Instant};

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

#[derive(Debug, Clone)]
pub struct PlaybackCoordinator {
    snapshot: PlaybackSnapshot,
    released_sequence: Option<u64>,
    rate: f64,
    sleep_timer_deadline: Option<Instant>,
    sleep_timer_remaining: Option<u64>,
}

impl Default for PlaybackCoordinator {
    fn default() -> Self {
        Self {
            snapshot: PlaybackSnapshot::default(),
            released_sequence: None,
            rate: 1.0,
            sleep_timer_deadline: None,
            sleep_timer_remaining: None,
        }
    }
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
        if self.snapshot.media.as_ref().is_none_or(|current| current.id != media.id) {
            self.rate = 1.0;
        }
        self.snapshot.status = PlaybackStatus::Loading;
        self.snapshot.position = 0.0;
        self.snapshot.duration = media.duration.unwrap_or(0.0);
        self.snapshot.error = None;
        self.snapshot.session_unavailable = false;
        self.snapshot.holder = None;
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
        self.set_sleep_timer(None);
        self.snapshot.status = PlaybackStatus::Paused;
        self.snapshot.session_unavailable = true;
        self.snapshot.error = Some("Playback moved to another device".into());
    }

    pub fn session_unavailable(&mut self, message: impl Into<String>) {
        self.set_sleep_timer(None);
        self.snapshot.status = PlaybackStatus::Paused;
        self.snapshot.session_unavailable = true;
        self.snapshot.error = Some(message.into());
    }

    /// Record who holds the exclusive lease. Cleared with `session_unavailable`.
    pub fn set_holder(&mut self, holder: Option<SessionHolder>) {
        self.snapshot.holder = holder;
    }

    pub fn remote_available(&mut self) {
        if self.snapshot.session_unavailable {
            self.snapshot.status = PlaybackStatus::Paused;
            self.snapshot.session_unavailable = false;
            self.snapshot.holder = None;
            self.snapshot.error = None;
        }
    }

    /// Update only the remote-observer fields used by SessionConflictCard.
    pub fn update_remote_state(&mut self, media: Media, holder: SessionHolder) {
        self.snapshot.media = Some(media);
        self.snapshot.holder = Some(holder);
        self.snapshot.session_unavailable = true;
    }

    pub fn observe_remote(&mut self, media: Media, holder: SessionHolder) {
        self.set_sleep_timer(None);
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

    pub fn set_rate(&mut self, rate: f64) {
        self.rate = if rate.is_finite() { rate.clamp(0.25, 3.0) } else { 1.0 };
    }

    pub fn rate(&self) -> f64 {
        self.rate
    }

    pub fn set_sleep_timer(&mut self, minutes: Option<u32>) {
        let seconds = minutes.filter(|value| *value > 0).map(u64::from).map(|value| value * 60);
        self.sleep_timer_deadline = seconds.map(|value| Instant::now() + Duration::from_secs(value));
        self.sleep_timer_remaining = seconds;
    }

    pub fn sleep_timer_remaining(&self) -> Option<u64> {
        self.sleep_timer_remaining
    }

    pub fn has_sleep_timer(&self) -> bool {
        self.sleep_timer_deadline.is_some()
    }

    pub fn sleep_timer_expired(&self) -> bool {
        self.sleep_timer_deadline.is_some_and(|deadline| Instant::now() >= deadline)
    }

    pub fn sleep_timer_update_needed(&self) -> bool {
        self.sleep_timer_deadline.is_some_and(|deadline| {
            let remaining = deadline.saturating_duration_since(Instant::now()).as_secs().max(1);
            self.sleep_timer_expired() || self.sleep_timer_remaining != Some(remaining)
        })
    }

    pub fn tick(&mut self) -> bool {
        let Some(deadline) = self.sleep_timer_deadline else {
            return false;
        };
        let remaining = deadline.saturating_duration_since(Instant::now()).as_secs();
        if remaining == 0 && Instant::now() >= deadline {
            let was_playing = matches!(self.snapshot.status, PlaybackStatus::Playing | PlaybackStatus::Loading);
            self.pause();
            self.sleep_timer_deadline = None;
            self.sleep_timer_remaining = None;
            return was_playing;
        }
        self.sleep_timer_remaining = Some(remaining.max(1));
        false
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
        self.set_sleep_timer(None);
        self.rate = 1.0;
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

    #[test]
    fn sleep_timer_pauses_at_deadline_and_clears_itself() {
        let mut coordinator = PlaybackCoordinator::default();
        coordinator.snapshot.status = PlaybackStatus::Playing;
        coordinator.set_sleep_timer(Some(15));
        assert_eq!(coordinator.sleep_timer_remaining(), Some(900));
        coordinator.sleep_timer_deadline = Some(Instant::now() - Duration::from_secs(1));

        assert!(coordinator.sleep_timer_expired());
        assert!(coordinator.tick());
        assert_eq!(coordinator.snapshot().status, PlaybackStatus::Paused);
        assert_eq!(coordinator.sleep_timer_remaining(), None);
        assert!(!coordinator.has_sleep_timer());
    }

    #[test]
    fn sleep_timer_can_be_disabled_without_pausing() {
        let mut coordinator = PlaybackCoordinator::default();
        coordinator.snapshot.status = PlaybackStatus::Playing;
        coordinator.set_sleep_timer(Some(30));
        coordinator.set_sleep_timer(None);

        assert!(!coordinator.tick());
        assert_eq!(coordinator.snapshot().status, PlaybackStatus::Playing);
        assert_eq!(coordinator.sleep_timer_remaining(), None);
    }
}
