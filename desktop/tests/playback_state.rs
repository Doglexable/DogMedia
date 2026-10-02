use dogmedia_desktop::{
    domain::{CategoryId, Media, MediaId, Quality},
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
    assert_eq!(coordinator.snapshot().status, PlaybackStatus::Loading);
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
