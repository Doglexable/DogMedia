use std::fmt;

use crate::domain::{CategoryId, MediaId};

use super::transport::HttpMethod;

/// Every backend route the desktop client may call.
///
/// Rendering paths in one place means a renamed server route is a compile
/// error here instead of a silent 404 at runtime.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Endpoint {
    CheckAccess,
    Categories,
    /// Rendered `api/media/browse` query string (see [`BrowseQuery::query_string`]).
    ///
    /// [`BrowseQuery::query_string`]: crate::domain::BrowseQuery::query_string
    Browse(String),
    Media(MediaId),
    PlaybackSession(MediaId),
    LeaseHeartbeat,
    LeaseRelease,
    PlaybackActive,
    PlaybackEvent,
    Resume(MediaId),
    ResumeSave(MediaId),
    QueueWindow,
    QueueItems,
    QueueNextItem,
    QueueItem(MediaId),
    QueueClear,
    QueueOrder,
    QueueSelect,
    QueueNext,
    QueuePrev,
    QueueShuffle,
    QueueAutoCategory {
        category: CategoryId,
        start: MediaId,
    },
    QueueAutoAll {
        start: Option<MediaId>,
    },
    QueueAutoLikes {
        start: Option<MediaId>,
    },
    Likes,
    Like(MediaId),
    Unlike(MediaId),
    Lyrics(MediaId),
    Subtitles(MediaId),
}

impl Endpoint {
    pub fn method(&self) -> HttpMethod {
        match self {
            Self::PlaybackSession(_)
            | Self::LeaseHeartbeat
            | Self::QueueItems
            | Self::QueueNextItem
            | Self::QueueSelect
            | Self::QueueNext
            | Self::QueuePrev
            | Self::QueueShuffle
            | Self::QueueAutoCategory { .. }
            | Self::QueueAutoAll { .. }
            | Self::QueueAutoLikes { .. }
            | Self::PlaybackActive
            | Self::PlaybackEvent
            | Self::ResumeSave(_) => HttpMethod::Post,
            Self::QueueOrder => HttpMethod::Put,
            Self::Like(_) => HttpMethod::Put,
            Self::LeaseRelease | Self::QueueItem(_) | Self::QueueClear | Self::Unlike(_) => {
                HttpMethod::Delete
            }
            _ => HttpMethod::Get,
        }
    }

    pub fn path(&self) -> String {
        match self {
            Self::CheckAccess => "api/check-access".to_owned(),
            Self::Categories => "api/categories".to_owned(),
            Self::Browse(query) => format!("api/media/browse?{query}"),
            Self::Media(id) => format!("api/media/{id}"),
            Self::PlaybackSession(id) => format!("api/media/{id}/playback-session"),
            Self::LeaseHeartbeat => "api/playback/lease/heartbeat".to_owned(),
            Self::LeaseRelease => "api/playback/lease".to_owned(),
            Self::PlaybackActive => "api/playback/active".to_owned(),
            Self::PlaybackEvent => "api/playback/event".to_owned(),
            Self::Resume(id) | Self::ResumeSave(id) => format!("api/playback/resume/{id}"),
            Self::QueueWindow => "api/queue/window?limit=100".to_owned(),
            Self::QueueItems => "api/queue/items".to_owned(),
            Self::QueueNextItem => "api/queue/items/next".to_owned(),
            Self::QueueItem(id) => format!("api/queue/items/{id}"),
            Self::QueueClear => "api/queue".to_owned(),
            Self::QueueOrder => "api/queue/window/order".to_owned(),
            Self::QueueSelect => "api/queue/select".to_owned(),
            Self::QueueNext => "api/queue/next".to_owned(),
            Self::QueuePrev => "api/queue/prev".to_owned(),
            Self::QueueShuffle => "api/queue/shuffle".to_owned(),
            Self::QueueAutoCategory { category, start } => {
                format!("api/queue/auto/{category}?start={start}&compact=1")
            }
            Self::QueueAutoAll { start } => match start {
                Some(id) => format!("api/queue/auto?start={id}&compact=1"),
                None => "api/queue/auto?compact=1".to_owned(),
            },
            Self::QueueAutoLikes { start } => match start {
                Some(id) => format!("api/queue/auto/likes?start={id}&compact=1"),
                None => "api/queue/auto/likes?compact=1".to_owned(),
            },
            Self::Likes => "api/likes".to_owned(),
            Self::Like(id) | Self::Unlike(id) => format!("api/likes/{id}"),
            Self::Lyrics(id) => format!("api/media/{id}/lyrics"),
            Self::Subtitles(id) => format!("api/media/{id}/subtitles"),
        }
    }
}

impl fmt::Display for Endpoint {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.path())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{CategoryId, MediaId};

    #[test]
    fn routes_render_with_typed_ids() {
        assert_eq!(Endpoint::Media(MediaId::new(4)).path(), "api/media/4");
        assert_eq!(
            Endpoint::QueueAutoCategory {
                category: CategoryId::new(7),
                start: MediaId::new(8),
            }
            .path(),
            "api/queue/auto/7?start=8&compact=1"
        );
        assert_eq!(
            Endpoint::QueueAutoAll { start: None }.path(),
            "api/queue/auto?compact=1"
        );
        assert_eq!(Endpoint::Like(MediaId::new(3)).method(), HttpMethod::Put);
        assert_eq!(
            Endpoint::Unlike(MediaId::new(3)).method(),
            HttpMethod::Delete
        );
    }
}
