use std::time::Duration;

use serde::Serialize;

use super::{ApiClient, ApiError, HttpMethod};
use crate::domain::{
    AccessStatus, BrowsePage, BrowseQuery, Category, Lyrics, Media, PlaybackReport,
    PlaybackSession, Quality, QueueOrder, QueueSelection, QueueWindow, ResumePosition,
    SubtitleTrack,
};

const NORMAL_TIMEOUT: Duration = Duration::from_secs(20);

impl ApiClient {
    pub async fn check_access(&self) -> Result<AccessStatus, ApiError> {
        self.json(
            HttpMethod::Get,
            "api/check-access",
            None::<&()>,
            None,
            Duration::from_millis(2_500),
        )
        .await
    }

    pub async fn categories(&self) -> Result<Vec<Category>, ApiError> {
        self.json(
            HttpMethod::Get,
            "api/categories",
            None::<&()>,
            None,
            NORMAL_TIMEOUT,
        )
        .await
    }

    pub async fn browse(&self, query: &BrowseQuery) -> Result<BrowsePage, ApiError> {
        let query_string = {
            let mut pairs = url::form_urlencoded::Serializer::new(String::new());
            pairs.append_pair("limit", &query.limit.clamp(1, 100).to_string());
            pairs.append_pair("type", query.media_type.as_query());
            if !query.search.trim().is_empty() {
                pairs.append_pair("q", query.search.trim());
            }
            if let Some(category_id) = query.category_id {
                pairs.append_pair("category_id", &category_id.to_string());
            }
            if query.liked {
                pairs.append_pair("view", "liked");
            }
            if let Some(cursor) = &query.cursor {
                pairs.append_pair("cursor", cursor);
            }
            pairs.finish()
        };
        self.json(
            HttpMethod::Get,
            &format!("api/media/browse?{query_string}"),
            None::<&()>,
            None,
            NORMAL_TIMEOUT,
        )
        .await
    }

    pub async fn media(&self, media_id: i64) -> Result<Media, ApiError> {
        self.json(
            HttpMethod::Get,
            &format!("api/media/{media_id}"),
            None::<&()>,
            None,
            NORMAL_TIMEOUT,
        )
        .await
    }

    pub async fn photo(&self, media_id: i64) -> Result<Vec<u8>, ApiError> {
        let session = self
            .create_playback_session(media_id, Quality::High)
            .await?;
        let result = self
            .bytes(
                HttpMethod::Get,
                &session.stream_url,
                Some((session.session_id.as_str(), session.viewer_id.as_str())),
            )
            .await;
        // A photo uses the same protected stream endpoint as audio and video.
        // Always revoke its short-lived session, including when the fetch fails.
        let _ = self.release(&session).await;
        result
    }

    pub async fn create_playback_session(
        &self,
        media_id: i64,
        quality: Quality,
    ) -> Result<PlaybackSession, ApiError> {
        #[derive(Serialize)]
        struct Body<'a> {
            quality: &'a str,
        }
        self.json(
            HttpMethod::Post,
            &format!("api/media/{media_id}/playback-session"),
            Some(&Body {
                quality: quality.as_str(),
            }),
            None,
            NORMAL_TIMEOUT,
        )
        .await
    }

    pub async fn heartbeat(&self, session: &PlaybackSession) -> Result<(), ApiError> {
        self.unit(
            HttpMethod::Post,
            "api/playback/lease/heartbeat",
            None::<&()>,
            Some(session),
        )
        .await
    }

    pub async fn release(&self, session: &PlaybackSession) -> Result<(), ApiError> {
        self.unit(
            HttpMethod::Delete,
            "api/playback/lease",
            None::<&()>,
            Some(session),
        )
        .await
    }

    pub async fn report(&self, path: &str, report: &PlaybackReport<'_>) -> Result<(), ApiError> {
        self.unit(HttpMethod::Post, path, Some(report), None).await
    }

    pub async fn resume(&self, media_id: i64) -> Result<ResumePosition, ApiError> {
        self.json(
            HttpMethod::Get,
            &format!("api/playback/resume/{media_id}"),
            None::<&()>,
            None,
            NORMAL_TIMEOUT,
        )
        .await
    }

    pub async fn save_resume(
        &self,
        media_id: i64,
        position: f64,
        duration: f64,
    ) -> Result<(), ApiError> {
        #[derive(Serialize)]
        struct Body {
            position: f64,
            duration: f64,
        }
        self.unit(
            HttpMethod::Post,
            &format!("api/playback/resume/{media_id}"),
            Some(&Body { position, duration }),
            None,
        )
        .await
    }

    pub async fn queue_window(&self) -> Result<QueueWindow, ApiError> {
        self.json(
            HttpMethod::Get,
            "api/queue/window?limit=100",
            None::<&()>,
            None,
            NORMAL_TIMEOUT,
        )
        .await
    }

    pub async fn queue_add(&self, media_id: i64, play_next: bool) -> Result<(), ApiError> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body {
            media_id: i64,
        }
        let path = if play_next {
            "api/queue/items/next"
        } else {
            "api/queue/items"
        };
        self.unit(HttpMethod::Post, path, Some(&Body { media_id }), None)
            .await
    }

    pub async fn queue_remove(&self, media_id: i64) -> Result<(), ApiError> {
        self.unit(
            HttpMethod::Delete,
            &format!("api/queue/items/{media_id}"),
            None::<&()>,
            None,
        )
        .await
    }

    pub async fn queue_clear(&self) -> Result<(), ApiError> {
        self.unit(HttpMethod::Delete, "api/queue", None::<&()>, None)
            .await
    }

    pub async fn queue_reorder(
        &self,
        order: &QueueOrder<'_>,
    ) -> Result<serde_json::Value, ApiError> {
        self.json(
            HttpMethod::Put,
            "api/queue/window/order",
            Some(order),
            None,
            NORMAL_TIMEOUT,
        )
        .await
    }

    pub async fn queue_select(&self, media_id: i64) -> Result<QueueSelection, ApiError> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body {
            media_id: i64,
        }
        self.json(
            HttpMethod::Post,
            "api/queue/select",
            Some(&Body { media_id }),
            None,
            NORMAL_TIMEOUT,
        )
        .await
    }

    pub async fn queue_navigate(&self, forward: bool) -> Result<QueueSelection, ApiError> {
        let path = if forward {
            "api/queue/next"
        } else {
            "api/queue/prev"
        };
        self.json(HttpMethod::Post, path, None::<&()>, None, NORMAL_TIMEOUT)
            .await
    }

    pub async fn queue_shuffle(&self) -> Result<(), ApiError> {
        self.unit(HttpMethod::Post, "api/queue/shuffle", None::<&()>, None)
            .await
    }

    pub async fn favorites(&self) -> Result<Vec<Media>, ApiError> {
        self.json(
            HttpMethod::Get,
            "api/likes",
            None::<&()>,
            None,
            NORMAL_TIMEOUT,
        )
        .await
    }

    pub async fn set_favorite(&self, media_id: i64, liked: bool) -> Result<(), ApiError> {
        let method = if liked {
            HttpMethod::Put
        } else {
            HttpMethod::Delete
        };
        self.unit(method, &format!("api/likes/{media_id}"), None::<&()>, None)
            .await
    }

    pub async fn lyrics(&self, media_id: i64) -> Result<Option<Lyrics>, ApiError> {
        match self
            .json(
                HttpMethod::Get,
                &format!("api/media/{media_id}/lyrics"),
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

    pub async fn subtitles(&self, media_id: i64) -> Result<Vec<SubtitleTrack>, ApiError> {
        self.json(
            HttpMethod::Get,
            &format!("api/media/{media_id}/subtitles"),
            None::<&()>,
            None,
            NORMAL_TIMEOUT,
        )
        .await
    }

    pub async fn subtitle_file(&self, path: &str) -> Result<Vec<u8>, ApiError> {
        self.bytes(HttpMethod::Get, path, None).await
    }

    async fn unit<B: Serialize + ?Sized>(
        &self,
        method: HttpMethod,
        path: &str,
        body: Option<&B>,
        session: Option<&PlaybackSession>,
    ) -> Result<(), ApiError> {
        self.raw(
            method,
            path,
            body,
            session.map(|value| (value.session_id.as_str(), value.viewer_id.as_str())),
            NORMAL_TIMEOUT,
        )
        .await?;
        Ok(())
    }
}
