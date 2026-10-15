use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::{ApiClient, ApiError, Endpoint};
use crate::domain::{
    AccessStatus, BrowsePage, BrowseQuery, Category, CategoryId, DashboardQuery, DashboardSummary,
    LeaseStatus, Lyrics, Media, MediaId, PlaybackReport, PlaybackSession, Quality,
    QueueAppendResult, QueueAutoResult, QueueOrder, QueueOrderResult, QueueSelection, QueueWindow,
    ResumePosition, SessionHolder, StreamPath, SubtitleTrack,
};

const NORMAL_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct ArtworkPalette {
    pub colors: Vec<PaletteColor>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct PaletteColor {
    pub hex: String,
    pub percentage: f64,
}

#[derive(Serialize)]
struct CreateSessionRequest {
    quality: Quality,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaIdRequest {
    media_id: MediaId,
}

#[derive(Serialize)]
struct SaveResumeRequest {
    position: f64,
    duration: f64,
}

impl ApiClient {
    pub async fn playback_socket_ticket(&self) -> Result<String, ApiError> {
        #[derive(serde::Deserialize)]
        struct Ticket {
            ticket: String,
        }
        let result: Ticket = self
            .json_endpoint(&Endpoint::SocketTicket, None::<&()>, None, NORMAL_TIMEOUT)
            .await?;
        Ok(result.ticket)
    }

    pub async fn check_access(&self) -> Result<AccessStatus, ApiError> {
        self.json_endpoint(
            &Endpoint::CheckAccess,
            None::<&()>,
            None,
            Duration::from_millis(2_500),
        )
        .await
    }

    pub async fn categories(&self) -> Result<Vec<Category>, ApiError> {
        self.json_endpoint(&Endpoint::Categories, None::<&()>, None, NORMAL_TIMEOUT)
            .await
    }

    pub async fn category_thumbnail(&self, category_id: CategoryId) -> Result<Vec<u8>, ApiError> {
        self.bytes(
            super::transport::HttpMethod::Get,
            &Endpoint::CategoryThumbnail(category_id).path(),
            None,
        )
        .await
    }

    pub async fn browse(&self, query: &BrowseQuery) -> Result<BrowsePage, ApiError> {
        self.json_endpoint(
            &Endpoint::Browse(query.query_string()),
            None::<&()>,
            None,
            NORMAL_TIMEOUT,
        )
        .await
    }

    pub async fn media(&self, media_id: MediaId) -> Result<Media, ApiError> {
        self.json_endpoint(
            &Endpoint::Media(media_id),
            None::<&()>,
            None,
            NORMAL_TIMEOUT,
        )
        .await
    }

    pub async fn dashboard(&self, query: &DashboardQuery) -> Result<DashboardSummary, ApiError> {
        self.json_endpoint(
            &Endpoint::Dashboard(query.query_string()),
            None::<&()>,
            None,
            NORMAL_TIMEOUT,
        )
        .await
    }

    pub async fn media_thumbnail(&self, media_id: MediaId) -> Result<Vec<u8>, ApiError> {
        self.bytes(
            super::transport::HttpMethod::Get,
            &Endpoint::MediaThumbnail(media_id).path(),
            None,
        )
        .await
    }

    pub async fn artwork_palette(&self, media_id: MediaId) -> Result<ArtworkPalette, ApiError> {
        self.json_endpoint(
            &Endpoint::ArtworkPalette(media_id),
            None::<&()>,
            None,
            NORMAL_TIMEOUT,
        )
        .await
    }

    pub async fn photo(&self, media_id: MediaId) -> Result<Vec<u8>, ApiError> {
        let session = self
            .create_playback_session(media_id, Quality::High)
            .await?;
        let result = self
            .bytes(
                super::transport::HttpMethod::Get,
                session.stream_url.as_str(),
                Some(&session),
            )
            .await;
        // A photo uses the same protected stream endpoint as audio and video.
        // Always revoke its short-lived session, including when the fetch fails.
        let _ = self.release(&session).await;
        result
    }

    pub async fn create_playback_session(
        &self,
        media_id: MediaId,
        quality: Quality,
    ) -> Result<PlaybackSession, ApiError> {
        self.json_endpoint(
            &Endpoint::PlaybackSession(media_id),
            Some(&CreateSessionRequest { quality }),
            None,
            NORMAL_TIMEOUT,
        )
        .await
    }

    pub async fn heartbeat(&self, session: &PlaybackSession) -> Result<(), ApiError> {
        self.unit_endpoint(&Endpoint::LeaseHeartbeat, None::<&()>, Some(session))
            .await
    }

    pub async fn release(&self, session: &PlaybackSession) -> Result<(), ApiError> {
        self.unit_endpoint(&Endpoint::LeaseRelease, None::<&()>, Some(session))
            .await
    }

    pub async fn force_release_playback_lease(&self) -> Result<(), ApiError> {
        self.unit_endpoint(&Endpoint::LeaseForceRelease, None::<&()>, None)
            .await
    }

    pub async fn playback_lease(&self) -> Result<LeaseStatus, ApiError> {
        let mut status: LeaseStatus = self
            .json_endpoint(&Endpoint::LeaseStatus, None::<&()>, None, NORMAL_TIMEOUT)
            .await?;
        status.active_session = status.active_session.map(SessionHolder::normalized);
        Ok(status)
    }

    pub async fn report(
        &self,
        endpoint: &Endpoint,
        report: &PlaybackReport<'_>,
        session: Option<&PlaybackSession>,
    ) -> Result<(), ApiError> {
        self.unit_endpoint(endpoint, Some(report), session).await
    }

    pub async fn resume(&self, media_id: MediaId) -> Result<ResumePosition, ApiError> {
        self.json_endpoint(
            &Endpoint::Resume(media_id),
            None::<&()>,
            None,
            NORMAL_TIMEOUT,
        )
        .await
    }

    pub async fn save_resume(
        &self,
        media_id: MediaId,
        position: f64,
        duration: f64,
    ) -> Result<(), ApiError> {
        self.unit_endpoint(
            &Endpoint::ResumeSave(media_id),
            Some(&SaveResumeRequest { position, duration }),
            None,
        )
        .await
    }

    pub async fn queue_window(&self) -> Result<QueueWindow, ApiError> {
        self.json_endpoint(&Endpoint::QueueWindow, None::<&()>, None, NORMAL_TIMEOUT)
            .await
    }

    pub async fn queue_window_at(
        &self,
        offset: usize,
        limit: usize,
    ) -> Result<QueueWindow, ApiError> {
        self.json_endpoint(
            &Endpoint::QueueWindowAt { offset, limit },
            None::<&()>,
            None,
            NORMAL_TIMEOUT,
        )
        .await
    }

    pub async fn queue_add(&self, media_id: MediaId, play_next: bool) -> Result<(), ApiError> {
        let endpoint = if play_next {
            Endpoint::QueueNextItem
        } else {
            Endpoint::QueueItems
        };
        self.unit_endpoint(&endpoint, Some(&MediaIdRequest { media_id }), None)
            .await
    }

    pub async fn queue_remove(&self, media_id: MediaId) -> Result<(), ApiError> {
        self.unit_endpoint(&Endpoint::QueueItem(media_id), None::<&()>, None)
            .await
    }

    pub async fn queue_clear(&self) -> Result<(), ApiError> {
        self.unit_endpoint(&Endpoint::QueueClear, None::<&()>, None)
            .await
    }

    pub async fn queue_reorder(
        &self,
        order: &QueueOrder<'_>,
    ) -> Result<QueueOrderResult, ApiError> {
        self.json_endpoint(&Endpoint::QueueOrder, Some(order), None, NORMAL_TIMEOUT)
            .await
    }

    pub async fn queue_select(&self, media_id: MediaId) -> Result<QueueSelection, ApiError> {
        self.json_endpoint(
            &Endpoint::QueueSelect,
            Some(&MediaIdRequest { media_id }),
            None,
            NORMAL_TIMEOUT,
        )
        .await
    }

    pub async fn queue_navigate(&self, forward: bool) -> Result<QueueSelection, ApiError> {
        let endpoint = if forward {
            Endpoint::QueueNext
        } else {
            Endpoint::QueuePrev
        };
        self.json_endpoint(&endpoint, None::<&()>, None, NORMAL_TIMEOUT)
            .await
    }

    pub async fn queue_shuffle(&self) -> Result<(), ApiError> {
        self.unit_endpoint(&Endpoint::QueueShuffle, None::<&()>, None)
            .await
    }

    /// Replace the entire queue with media from a specific category, starting
    /// playback at `start_media_id`. Returns a compact queue summary.
    pub async fn queue_auto_category(
        &self,
        category_id: CategoryId,
        start_media_id: MediaId,
    ) -> Result<QueueAutoResult, ApiError> {
        self.json_endpoint(
            &Endpoint::QueueAutoCategory {
                category: category_id,
                start: start_media_id,
            },
            None::<&()>,
            None,
            NORMAL_TIMEOUT,
        )
        .await
    }

    /// Replace the entire queue with media from a folder ordered by track
    /// number, starting from the first track. Returns a compact result
    /// including the first `current_media_id` to play.
    pub async fn queue_play_folder(
        &self,
        category_id: CategoryId,
    ) -> Result<QueueAutoResult, ApiError> {
        self.json_endpoint(
            &Endpoint::QueuePlayFolder {
                category: category_id,
            },
            None::<&()>,
            None,
            NORMAL_TIMEOUT,
        )
        .await
    }

    /// Append all folder audio to the end of the queue without touching the
    /// existing items. Returns how many tracks were actually added.
    pub async fn queue_append_folder(
        &self,
        category_id: CategoryId,
    ) -> Result<QueueAppendResult, ApiError> {
        self.json_endpoint(
            &Endpoint::QueueAppendFolder {
                category: category_id,
            },
            None::<&()>,
            None,
            NORMAL_TIMEOUT,
        )
        .await
    }

    /// Replace the entire queue with all accessible media, optionally starting
    /// at a given media ID.
    pub async fn queue_auto_all(
        &self,
        start_media_id: Option<MediaId>,
    ) -> Result<QueueAutoResult, ApiError> {
        self.json_endpoint(
            &Endpoint::QueueAutoAll {
                start: start_media_id,
            },
            None::<&()>,
            None,
            NORMAL_TIMEOUT,
        )
        .await
    }

    /// Replace the entire queue with liked audio, optionally starting at a given
    /// media ID.
    pub async fn queue_auto_likes(
        &self,
        start_media_id: Option<MediaId>,
    ) -> Result<QueueAutoResult, ApiError> {
        self.json_endpoint(
            &Endpoint::QueueAutoLikes {
                start: start_media_id,
            },
            None::<&()>,
            None,
            NORMAL_TIMEOUT,
        )
        .await
    }

    pub async fn favorites(&self) -> Result<Vec<Media>, ApiError> {
        self.json_endpoint(&Endpoint::Likes, None::<&()>, None, NORMAL_TIMEOUT)
            .await
    }

    pub async fn set_favorite(&self, media_id: MediaId, liked: bool) -> Result<(), ApiError> {
        let endpoint = if liked {
            Endpoint::Like(media_id)
        } else {
            Endpoint::Unlike(media_id)
        };
        self.unit_endpoint(&endpoint, None::<&()>, None).await
    }

    pub async fn lyrics(&self, media_id: MediaId) -> Result<Option<Lyrics>, ApiError> {
        match self
            .json_endpoint(
                &Endpoint::Lyrics(media_id),
                None::<&()>,
                None,
                NORMAL_TIMEOUT,
            )
            .await
        {
            Err(ApiError::Http { status: 404, .. }) => Ok(None),
            result => result.map(Some),
        }
    }

    pub async fn subtitles(&self, media_id: MediaId) -> Result<Vec<SubtitleTrack>, ApiError> {
        self.json_endpoint(
            &Endpoint::Subtitles(media_id),
            None::<&()>,
            None,
            NORMAL_TIMEOUT,
        )
        .await
    }

    pub async fn subtitle_file(&self, path: &StreamPath) -> Result<Vec<u8>, ApiError> {
        self.bytes(super::transport::HttpMethod::Get, path.as_str(), None)
            .await
    }

    async fn unit_endpoint<B: Serialize + ?Sized>(
        &self,
        endpoint: &Endpoint,
        body: Option<&B>,
        session: Option<&PlaybackSession>,
    ) -> Result<(), ApiError> {
        self.raw(
            endpoint.method(),
            &endpoint.path(),
            body,
            session,
            NORMAL_TIMEOUT,
        )
        .await?;
        Ok(())
    }
}
