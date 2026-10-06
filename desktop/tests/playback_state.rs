use dogmedia_desktop::{
    domain::{CategoryId, Media, MediaId, Quality, RemotePlayback, SessionHolder},
    playback::{Effect, PlaybackCoordinator, PlaybackStatus, RepeatMode},
};

fn media(id: MediaId) -> Media {
    Media {
        id,
        title: Some(format!("Media {}", id.get())),
        artists: None,
        description: None,
        duration: Some(60.0),
        mime_type: Some("audio/mpeg".into()),
        category_id: Some(CategoryId::new(1)),
        category_name: None,
        category_path: None,
        artwork_version: None,
        liked: false,
        source_version: Some(1),
        created_at: None,
    }
}

#[test]
fn stale_load_is_rejected() {
    let mut coordinator = PlaybackCoordinator::default();
    coordinator.load(media(MediaId::new(1)));
    let stale = coordinator.snapshot().sequence;
    coordinator.load(media(MediaId::new(2)));
    assert!(!coordinator.loaded(stale, 0.0));
    assert!(!coordinator.loaded_paused(stale, 0.0));
    assert_eq!(coordinator.snapshot().status, PlaybackStatus::Loading);
}

#[test]
fn loaded_paused_sets_paused_status_at_position() {
    let mut coordinator = PlaybackCoordinator::default();
    coordinator.load(media(MediaId::new(1)));
    let sequence = coordinator.snapshot().sequence;
    assert!(coordinator.loaded_paused(sequence, 15.5));
    assert_eq!(coordinator.snapshot().status, PlaybackStatus::Paused);
    assert_eq!(coordinator.snapshot().position, 15.5);
}

#[test]
fn play_and_pause_from_loading_state_transition_properly() {
    let mut coordinator = PlaybackCoordinator::default();
    coordinator.load(media(MediaId::new(1)));
    assert_eq!(coordinator.snapshot().status, PlaybackStatus::Loading);
    coordinator.play();
    assert_eq!(coordinator.snapshot().status, PlaybackStatus::Playing);

    let mut coordinator2 = PlaybackCoordinator::default();
    coordinator2.load(media(MediaId::new(1)));
    assert_eq!(coordinator2.snapshot().status, PlaybackStatus::Loading);
    coordinator2.pause();
    assert_eq!(coordinator2.snapshot().status, PlaybackStatus::Paused);
}

#[test]
fn replacement_orders_persist_stop_release_before_session() {
    let mut coordinator = PlaybackCoordinator::default();
    coordinator.load(media(MediaId::new(1)));
    let effects = coordinator.load(media(MediaId::new(2)));
    assert_eq!(
        effects[0..3],
        [
            Effect::PersistProgress,
            Effect::StopPipeline,
            Effect::ReleaseLease
        ]
    );
    assert!(matches!(
        effects[3],
        Effect::CreateSession { media_id, .. } if media_id == MediaId::new(2)
    ));
}

#[test]
fn quality_restart_keeps_position_and_lease_loss_pauses() {
    let mut coordinator = PlaybackCoordinator::default();
    coordinator.load(media(MediaId::new(1)));
    coordinator.update_position(25.5);
    assert_eq!(
        coordinator.set_quality(Quality::Low),
        Some(Effect::CreateSession {
            media_id: MediaId::new(1),
            quality: Quality::Low,
            position: 25.5
        })
    );
    coordinator.lease_lost();
    assert_eq!(coordinator.snapshot().status, PlaybackStatus::Paused);
    assert!(coordinator.snapshot().session_unavailable);

    coordinator.load(media(MediaId::new(2)));
    assert!(!coordinator.snapshot().session_unavailable);
}

#[test]
fn remote_position_is_not_overwritten_by_the_previous_local_pipeline() {
    let mut coordinator = PlaybackCoordinator::default();
    coordinator.load(media(MediaId::new(5)));
    coordinator.update_timing(50.0, 60.0);
    coordinator.observe_remote(
        media(MediaId::new(6)),
        SessionHolder {
            platform: Some("web".to_owned()),
            media_id: Some(MediaId::new(6)),
            playback: Some(Box::new(RemotePlayback {
                media_id: MediaId::new(6),
                action: "play".to_owned(),
                position: 0.0,
                duration: 60.0,
                ..Default::default()
            })),
            ..Default::default()
        },
        None,
    );

    coordinator.update_timing(50.0, 60.0);
    assert_eq!(
        coordinator.snapshot().media.as_ref().map(|item| item.id),
        Some(MediaId::new(6))
    );
    assert_eq!(coordinator.snapshot().position, 0.0);

    coordinator.load(media(MediaId::new(6)));
    coordinator.update_timing(2.0, 60.0);
    assert_eq!(coordinator.snapshot().position, 2.0);
}

#[test]
fn holder_is_stored_and_cleared_with_session_availability() {
    let mut coordinator = PlaybackCoordinator::default();
    coordinator.load(media(MediaId::new(1)));
    coordinator.session_unavailable("busy");
    coordinator.set_holder(
        Some(SessionHolder {
            platform: Some("desktop".to_owned()),
            device_label: Some("Studio PC".to_owned()),
            media_id: Some(MediaId::new(9)),
            expires_in: Some(20),
            playback: None,
        }),
        Some(20),
    );
    assert_eq!(
        coordinator
            .snapshot()
            .holder
            .as_ref()
            .map(SessionHolder::display_label),
        Some("Studio PC".to_owned())
    );
    assert_eq!(coordinator.snapshot().holder_retry_after, Some(20));
    coordinator.load(media(MediaId::new(2)));
    assert!(coordinator.snapshot().holder.is_none());
    assert!(coordinator.snapshot().holder_retry_after.is_none());
    // Fallback labels never leak identifiers.
    assert_eq!(SessionHolder::default().display_label(), "Another device");
    assert_eq!(
        SessionHolder {
            platform: Some("mobile".to_owned()),
            ..Default::default()
        }
        .display_label(),
        "Dogmedia Mobile"
    );
}

#[test]
fn stop_is_idempotent_and_queue_modes_are_bounded() {
    let mut coordinator = PlaybackCoordinator::default();
    coordinator.load(media(MediaId::new(1)));
    assert!(coordinator.stop().contains(&Effect::ReleaseLease));
    assert!(coordinator.snapshot().media.is_none());
    assert_eq!(coordinator.snapshot().status, PlaybackStatus::Idle);
    assert!(coordinator.stop().is_empty());
    coordinator.set_repeat(RepeatMode::Queue);
    assert_eq!(coordinator.next_index(2, 3), Some(0));
    coordinator.set_repeat(RepeatMode::One);
    assert_eq!(coordinator.next_index(2, 3), Some(2));
}
