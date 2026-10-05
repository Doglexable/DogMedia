use std::sync::Arc;

use mpris_server::{Metadata, PlaybackStatus as MprisPlaybackStatus, Player, Time, TrackId};
use tokio::sync::{Mutex, mpsc, watch};

use crate::{
    domain::{Media, QueueWindow, Volume},
    playback::{PlaybackSnapshot, PlaybackStatus, RepeatMode},
};

const BUS_NAME_SUFFIX: &str = "com.dogmedia.Desktop";
const DESKTOP_ENTRY: &str = "com.dogmedia.Desktop";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MprisCommand {
    SetPlaying(bool),
    Toggle,
    Previous,
    Next,
}

#[derive(Debug, Clone, PartialEq)]
struct TrackMetadata {
    track_id: String,
    title: String,
    artist: Option<String>,
    album: Option<String>,
    duration_micros: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct MprisState {
    status: MprisPlaybackStatus,
    metadata: Option<TrackMetadata>,
    position_micros: i64,
    volume: f64,
    can_play: bool,
    can_pause: bool,
    can_go_previous: bool,
    can_go_next: bool,
}

impl Default for MprisState {
    fn default() -> Self {
        Self {
            status: MprisPlaybackStatus::Stopped,
            metadata: None,
            position_micros: 0,
            volume: Volume::default().get(),
            can_play: false,
            can_pause: false,
            can_go_previous: false,
            can_go_next: false,
        }
    }
}

impl MprisState {
    pub(crate) fn from_playback(
        snapshot: &PlaybackSnapshot,
        queue: Option<&QueueWindow>,
        volume: Volume,
        engine_available: bool,
    ) -> Self {
        let Some(media) = snapshot.media.as_ref().filter(|media| !media.is_photo()) else {
            return Self {
                volume: volume.get(),
                ..Self::default()
            };
        };

        let status = match snapshot.status {
            PlaybackStatus::Playing => MprisPlaybackStatus::Playing,
            PlaybackStatus::Paused | PlaybackStatus::Loading => MprisPlaybackStatus::Paused,
            PlaybackStatus::Idle | PlaybackStatus::Ended | PlaybackStatus::Failed => {
                MprisPlaybackStatus::Stopped
            }
        };
        let controllable = engine_available
            && !snapshot.session_unavailable
            && !matches!(
                snapshot.status,
                PlaybackStatus::Idle
                    | PlaybackStatus::Loading
                    | PlaybackStatus::Ended
                    | PlaybackStatus::Failed
            );
        let current_queue = queue.filter(|queue| queue.current_media_id == Some(media.id));
        let repeat_queue = snapshot.repeat == RepeatMode::Queue
            && current_queue.is_some_and(|queue| queue.total > 1);
        let can_go_next =
            controllable && current_queue.is_some_and(|queue| queue.has_next || repeat_queue);
        let can_go_previous = controllable
            && (snapshot.position > 3.0
                || current_queue.is_some_and(|queue| queue.has_previous || repeat_queue));

        Self {
            status,
            metadata: Some(track_metadata(media, snapshot.duration)),
            position_micros: seconds_to_micros(snapshot.position),
            volume: volume.get(),
            can_play: controllable,
            can_pause: controllable,
            can_go_previous,
            can_go_next,
        }
    }
}

fn track_metadata(media: &Media, duration: f64) -> TrackMetadata {
    let album = media
        .category_name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            media
                .category_path
                .as_deref()
                .filter(|value| !value.trim().is_empty())
        })
        .map(str::to_owned);
    TrackMetadata {
        track_id: format!("/com/dogmedia/track/{}", media.id.get()),
        title: media.title().to_owned(),
        artist: media
            .artists
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(str::to_owned),
        album,
        duration_micros: seconds_to_micros(duration),
    }
}

fn seconds_to_micros(seconds: f64) -> i64 {
    if !seconds.is_finite() || seconds <= 0.0 {
        return 0;
    }
    (seconds * 1_000_000.0).min(i64::MAX as f64) as i64
}

struct BridgeInner {
    state_tx: watch::Sender<MprisState>,
    // App owns the only receiver task. The mutex only lets cloned bridge handles
    // share ownership without moving Dioxus state onto the D-Bus thread.
    command_rx: Mutex<mpsc::UnboundedReceiver<MprisCommand>>,
    shutdown_tx: watch::Sender<bool>,
}

impl Drop for BridgeInner {
    fn drop(&mut self) {
        let _ = self.shutdown_tx.send(true);
    }
}

#[derive(Clone)]
pub(crate) struct MprisBridge {
    inner: Arc<BridgeInner>,
}

impl MprisBridge {
    pub(crate) fn start() -> Self {
        let (state_tx, state_rx) = watch::channel(MprisState::default());
        let (command_tx, command_rx) = mpsc::unbounded_channel();
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        let bridge = Self {
            inner: Arc::new(BridgeInner {
                state_tx,
                command_rx: Mutex::new(command_rx),
                shutdown_tx,
            }),
        };

        if let Err(error) = std::thread::Builder::new()
            .name("dogmedia-mpris".to_owned())
            .spawn(move || run_service(command_tx, state_rx, shutdown_rx))
        {
            tracing::warn!(%error, "unable to start MPRIS service thread");
        }

        bridge
    }

    pub(crate) async fn next_command(&self) -> Option<MprisCommand> {
        self.inner.command_rx.lock().await.recv().await
    }

    pub(crate) fn publish(&self, state: MprisState) {
        self.inner.state_tx.send_if_modified(|current| {
            if *current == state {
                return false;
            }
            *current = state;
            true
        });
    }
}

fn run_service(
    command_tx: mpsc::UnboundedSender<MprisCommand>,
    state_rx: watch::Receiver<MprisState>,
    shutdown_rx: watch::Receiver<bool>,
) {
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            tracing::warn!(%error, "unable to initialize MPRIS runtime");
            return;
        }
    };
    let local = tokio::task::LocalSet::new();
    if let Err(error) = local.block_on(&runtime, serve_player(command_tx, state_rx, shutdown_rx)) {
        tracing::warn!(%error, "MPRIS service is unavailable");
    }
}

async fn serve_player(
    command_tx: mpsc::UnboundedSender<MprisCommand>,
    mut state_rx: watch::Receiver<MprisState>,
    mut shutdown_rx: watch::Receiver<bool>,
) -> mpris_server::zbus::Result<()> {
    let player = Player::builder(BUS_NAME_SUFFIX)
        .identity("Dogmedia")
        .desktop_entry(DESKTOP_ENTRY)
        .can_control(true)
        .build()
        .await?;

    connect_command(&player, &command_tx, |player, sender| {
        player.connect_pause(move |_| {
            let _ = sender.send(MprisCommand::SetPlaying(false));
        });
    });
    connect_command(&player, &command_tx, |player, sender| {
        player.connect_play(move |_| {
            let _ = sender.send(MprisCommand::SetPlaying(true));
        });
    });
    connect_command(&player, &command_tx, |player, sender| {
        player.connect_play_pause(move |_| {
            let _ = sender.send(MprisCommand::Toggle);
        });
    });
    connect_command(&player, &command_tx, |player, sender| {
        player.connect_previous(move |_| {
            let _ = sender.send(MprisCommand::Previous);
        });
    });
    connect_command(&player, &command_tx, |player, sender| {
        player.connect_next(move |_| {
            let _ = sender.send(MprisCommand::Next);
        });
    });

    tokio::task::spawn_local(player.run());
    apply_state(&player, &state_rx.borrow().clone()).await?;

    loop {
        tokio::select! {
            changed = state_rx.changed() => {
                if changed.is_err() {
                    break;
                }
                apply_state(&player, &state_rx.borrow().clone()).await?;
            }
            changed = shutdown_rx.changed() => {
                if changed.is_err() || *shutdown_rx.borrow() {
                    break;
                }
            }
        }
    }
    Ok(())
}

fn connect_command(
    player: &Player,
    sender: &mpsc::UnboundedSender<MprisCommand>,
    connect: impl FnOnce(&Player, mpsc::UnboundedSender<MprisCommand>),
) {
    connect(player, sender.clone());
}

async fn apply_state(player: &Player, state: &MprisState) -> mpris_server::zbus::Result<()> {
    player.set_position(Time::from_micros(state.position_micros));
    player.set_playback_status(state.status).await?;
    player
        .set_metadata(to_metadata(state.metadata.as_ref()))
        .await?;
    player.set_volume(state.volume).await?;
    player.set_can_play(state.can_play).await?;
    player.set_can_pause(state.can_pause).await?;
    player.set_can_go_previous(state.can_go_previous).await?;
    player.set_can_go_next(state.can_go_next).await?;
    Ok(())
}

fn to_metadata(metadata: Option<&TrackMetadata>) -> Metadata {
    let Some(metadata) = metadata else {
        return Metadata::new();
    };
    let Ok(track_id) = TrackId::try_from(metadata.track_id.clone()) else {
        return Metadata::new();
    };
    let mut builder = Metadata::builder()
        .trackid(track_id)
        .title(metadata.title.clone())
        .length(Time::from_micros(metadata.duration_micros));
    if let Some(artist) = &metadata.artist {
        builder = builder.artist([artist.clone()]);
    }
    if let Some(album) = &metadata.album {
        builder = builder.album(album.clone());
    }
    builder.build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{CategoryId, MediaId, Quality, QueueItem};

    fn media(id: i64, mime_type: &str) -> Media {
        Media {
            id: MediaId::new(id),
            title: Some("Sunburn".into()),
            artists: Some("Muse, Guest".into()),
            description: None,
            duration: Some(215.25),
            mime_type: Some(mime_type.into()),
            category_id: Some(CategoryId::new(1)),
            category_name: Some("Showbiz".into()),
            category_path: Some("Music / Muse / Showbiz".into()),
            artwork_version: None,
            liked: false,
            source_version: Some(1),
            created_at: None,
        }
    }

    fn snapshot(media: Media, status: PlaybackStatus) -> PlaybackSnapshot {
        PlaybackSnapshot {
            sequence: 1,
            status,
            duration: media.duration.unwrap_or_default(),
            media: Some(media),
            position: 14.5,
            quality: Quality::High,
            repeat: RepeatMode::None,
            shuffle: false,
            session_unavailable: false,
            holder: None,
            holder_retry_after: None,
            error: None,
        }
    }

    fn queue(media: Media, has_previous: bool, has_next: bool) -> QueueWindow {
        QueueWindow {
            items: vec![QueueItem {
                media: media.clone(),
                position: Some(0),
            }],
            offset: 0,
            total: 2,
            current_index: 0,
            current_media_id: Some(media.id),
            has_previous,
            has_next,
            revision: 1,
        }
    }

    #[test]
    fn idle_and_photos_do_not_expose_tracks() {
        let idle =
            MprisState::from_playback(&PlaybackSnapshot::default(), None, Volume::new(0.5), true);
        assert_eq!(idle.status, MprisPlaybackStatus::Stopped);
        assert!(idle.metadata.is_none());
        assert!(!idle.can_play);

        let photo = snapshot(media(2, "image/jpeg"), PlaybackStatus::Playing);
        let state = MprisState::from_playback(&photo, None, Volume::new(0.5), true);
        assert_eq!(state.status, MprisPlaybackStatus::Stopped);
        assert!(state.metadata.is_none());
        assert!(!state.can_pause);
    }

    #[test]
    fn playing_audio_maps_metadata_timing_volume_and_controls() {
        let media = media(7, "audio/mpeg");
        let snapshot = snapshot(media.clone(), PlaybackStatus::Playing);
        let queue = queue(media, true, true);
        let state = MprisState::from_playback(&snapshot, Some(&queue), Volume::new(0.75), true);

        assert_eq!(state.status, MprisPlaybackStatus::Playing);
        let metadata = state.metadata.expect("audio metadata");
        assert_eq!(metadata.track_id, "/com/dogmedia/track/7");
        assert_eq!(metadata.title, "Sunburn");
        assert_eq!(metadata.artist.as_deref(), Some("Muse, Guest"));
        assert_eq!(metadata.album.as_deref(), Some("Showbiz"));
        assert_eq!(metadata.duration_micros, 215_250_000);
        assert_eq!(state.position_micros, 14_500_000);
        assert_eq!(state.volume, 0.75);
        assert!(state.can_play && state.can_pause);
        assert!(state.can_go_previous && state.can_go_next);
    }

    #[test]
    fn loading_unavailable_engine_and_stale_queue_disable_commands() {
        let active_media = media(7, "audio/mpeg");
        let active_queue = queue(active_media.clone(), true, true);
        let loading = snapshot(active_media.clone(), PlaybackStatus::Loading);
        let state =
            MprisState::from_playback(&loading, Some(&active_queue), Volume::default(), true);
        assert!(!state.can_play && !state.can_pause && !state.can_go_next);

        let ended = snapshot(active_media.clone(), PlaybackStatus::Ended);
        let state = MprisState::from_playback(&ended, Some(&active_queue), Volume::default(), true);
        assert_eq!(state.status, MprisPlaybackStatus::Stopped);
        assert!(!state.can_play && !state.can_pause && !state.can_go_next);

        let playing = snapshot(active_media, PlaybackStatus::Playing);
        let state =
            MprisState::from_playback(&playing, Some(&active_queue), Volume::default(), false);
        assert!(!state.can_play && !state.can_pause && !state.can_go_previous);

        let stale = queue(media(99, "audio/mpeg"), true, true);
        let state = MprisState::from_playback(&playing, Some(&stale), Volume::default(), true);
        assert!(!state.can_go_next);
        assert!(
            state.can_go_previous,
            "position over 3s restarts current track"
        );
    }

    #[test]
    fn queue_capabilities_respect_boundaries_and_repeat_queue() {
        let media = media(7, "audio/mpeg");
        let mut snapshot = snapshot(media.clone(), PlaybackStatus::Paused);
        snapshot.position = 1.0;
        let queue = queue(media, false, false);

        let bounded = MprisState::from_playback(&snapshot, Some(&queue), Volume::default(), true);
        assert!(!bounded.can_go_previous && !bounded.can_go_next);

        snapshot.repeat = RepeatMode::Queue;
        let repeated = MprisState::from_playback(&snapshot, Some(&queue), Volume::default(), true);
        assert!(repeated.can_go_previous && repeated.can_go_next);
    }

    #[test]
    fn timing_conversion_is_saturating_and_finite() {
        assert_eq!(seconds_to_micros(-1.0), 0);
        assert_eq!(seconds_to_micros(f64::NAN), 0);
        assert_eq!(seconds_to_micros(f64::INFINITY), 0);
        assert_eq!(seconds_to_micros(1.25), 1_250_000);
        assert_eq!(seconds_to_micros(f64::MAX), i64::MAX);
    }
}
