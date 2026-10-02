use std::{collections::BTreeMap, sync::Arc, time::Duration};

use serde::{Serialize, de::DeserializeOwned};
use thiserror::Error;

use super::endpoint::Endpoint;
use super::transport::{
    HttpMethod, RawResponse, RequestSpec, ReqwestTransport, Transport, TransportError,
};
use super::url::{ServerUrl, ServerUrlError};
use crate::domain::{PlaybackSession, StreamPath, ViewerId};

#[derive(Debug, Error, Clone)]
pub enum ApiError {
    #[error("server URL must use http or https")]
    UnsupportedScheme,
    #[error("invalid server URL: {0}")]
    InvalidUrl(#[from] url::ParseError),
    #[error("request timed out")]
    Timeout,
    #[error("server could not be reached: {0}")]
    Unreachable(String),
    #[error("access denied")]
    AccessDenied,
    #[error("playback is active on another device")]
    PlaybackInUse { retry_after: Option<u64> },
    #[error("the playback lease was lost")]
    PlaybackLeaseLost { retry_after: Option<u64> },
    #[error("queue changed; refresh and try again")]
    QueueChanged,
    #[error("the queue has no item there")]
    QueueEmpty,
    #[error("server returned {status}: {message}")]
    Http {
        status: u16,
        code: Option<String>,
        message: String,
    },
    #[error("server response was malformed: {0}")]
    Malformed(String),
}

impl ApiError {
    /// Short human-readable message for status banners and toasts.
    pub fn user_message(&self) -> String {
        match self {
            Self::AccessDenied => {
                "This computer's IP address is not allowed by the server.".to_owned()
            }
            Self::PlaybackInUse { retry_after } => match retry_after {
                Some(seconds) => {
                    format!("Playback is active on another device. Retry in {seconds}s.")
                }
                None => "Playback is active on another device.".to_owned(),
            },
            Self::PlaybackLeaseLost { retry_after } => match retry_after {
                Some(seconds) => {
                    format!("Playback moved to another device. Retry in {seconds}s.")
                }
                None => "Playback moved to another device.".to_owned(),
            },
            Self::QueueChanged => "Queue changed; refresh and try again.".to_owned(),
            Self::Http {
                status, message, ..
            } => {
                format!("Server returned {status}: {message}")
            }
            Self::Unreachable(message) => {
                format!("Unable to reach the server: {message}")
            }
            _ => self.to_string(),
        }
    }

    pub fn retry_after(&self) -> Option<u64> {
        match self {
            Self::PlaybackInUse { retry_after } | Self::PlaybackLeaseLost { retry_after } => {
                *retry_after
            }
            _ => None,
        }
    }
}

impl From<TransportError> for ApiError {
    fn from(value: TransportError) -> Self {
        match value {
            TransportError::Timeout => Self::Timeout,
            TransportError::Unreachable(message) => Self::Unreachable(message),
        }
    }
}

impl From<ServerUrlError> for ApiError {
    fn from(value: ServerUrlError) -> Self {
        match value {
            ServerUrlError::UnsupportedScheme => Self::UnsupportedScheme,
            ServerUrlError::MissingHost => Self::InvalidUrl(url::ParseError::EmptyHost),
            ServerUrlError::Invalid(message) => Self::Malformed(message),
        }
    }
}

#[derive(Clone)]
pub struct ApiClient {
    base_url: ServerUrl,
    viewer_id: ViewerId,
    transport: Arc<dyn Transport>,
}

impl ApiClient {
    pub fn new(base_url: &str, viewer_id: impl Into<ViewerId>) -> Result<Self, ApiError> {
        Self::with_transport(base_url, viewer_id, ReqwestTransport::new()?)
    }

    pub fn with_transport(
        base_url: &str,
        viewer_id: impl Into<ViewerId>,
        transport: Arc<dyn Transport>,
    ) -> Result<Self, ApiError> {
        Ok(Self {
            base_url: ServerUrl::parse(base_url)?,
            viewer_id: viewer_id.into(),
            transport,
        })
    }

    pub fn base_url(&self) -> &ServerUrl {
        &self.base_url
    }

    pub fn viewer_id(&self) -> &ViewerId {
        &self.viewer_id
    }

    /// Resolve a typed API route against the server origin.
    pub fn endpoint_url(&self, endpoint: &Endpoint) -> Result<url::Url, ApiError> {
        Ok(self.base_url.join(&endpoint.path())?)
    }

    /// Resolve a server-relative [`StreamPath`] (stream / subtitle URLs).
    pub fn absolute_url(&self, path: &StreamPath) -> Result<url::Url, ApiError> {
        Ok(self.base_url.join_stream(path)?)
    }

    pub fn is_insecure_remote(&self) -> bool {
        self.base_url.is_insecure_remote()
    }

    pub(crate) async fn json<T, B>(
        &self,
        method: HttpMethod,
        path: &str,
        body: Option<&B>,
        session: Option<&PlaybackSession>,
        timeout: Duration,
    ) -> Result<T, ApiError>
    where
        T: DeserializeOwned,
        B: Serialize + ?Sized,
    {
        let response = self.raw(method, path, body, session, timeout).await?;
        serde_json::from_slice(&response.body)
            .map_err(|error| ApiError::Malformed(error.to_string()))
    }

    pub(crate) async fn json_endpoint<T, B>(
        &self,
        endpoint: &Endpoint,
        body: Option<&B>,
        session: Option<&PlaybackSession>,
        timeout: Duration,
    ) -> Result<T, ApiError>
    where
        T: DeserializeOwned,
        B: Serialize + ?Sized,
    {
        self.json(endpoint.method(), &endpoint.path(), body, session, timeout)
            .await
    }

    pub(crate) async fn bytes(
        &self,
        method: HttpMethod,
        path: &str,
        session: Option<&PlaybackSession>,
    ) -> Result<Vec<u8>, ApiError> {
        Ok(self
            .raw(method, path, None::<&()>, session, Duration::from_secs(30))
            .await?
            .body)
    }

    pub(crate) async fn raw<B: Serialize + ?Sized>(
        &self,
        method: HttpMethod,
        path: &str,
        body: Option<&B>,
        session: Option<&PlaybackSession>,
        timeout: Duration,
    ) -> Result<RawResponse, ApiError> {
        let mut headers = BTreeMap::from([
            ("Accept".to_owned(), "application/json".to_owned()),
            ("X-Client-Platform".to_owned(), "desktop".to_owned()),
            ("X-Viewer-ID".to_owned(), self.viewer_id.as_str().to_owned()),
        ]);
        if body.is_some() {
            headers.insert("Content-Type".to_owned(), "application/json".to_owned());
        }
        if let Some(session) = session {
            headers.insert(
                "X-Playback-Session".to_owned(),
                session.session_id.as_str().to_owned(),
            );
            headers.insert(
                "X-Viewer-ID".to_owned(),
                session.viewer_id.as_str().to_owned(),
            );
        }
        let request = RequestSpec {
            method,
            url: self.base_url.join(path)?,
            headers,
            json: body
                .map(serde_json::to_value)
                .transpose()
                .map_err(|error| ApiError::Malformed(error.to_string()))?,
            timeout,
        };
        let response = self.transport.execute(request).await?;
        if !(200..300).contains(&response.status) {
            return Err(map_status(response));
        }
        Ok(response)
    }
}

fn map_status(response: RawResponse) -> ApiError {
    let payload: Option<serde_json::Value> = serde_json::from_slice(&response.body).ok();
    let code = payload
        .as_ref()
        .and_then(|value| value.get("code"))
        .and_then(|value| value.as_str())
        .map(str::to_owned);
    let message = payload
        .as_ref()
        .and_then(|value| value.get("error"))
        .and_then(|value| value.as_str())
        .unwrap_or("Request failed")
        .to_owned();
    let retry_after = payload
        .as_ref()
        .and_then(|value| value.get("retryAfter"))
        .and_then(serde_json::Value::as_u64);
    match (response.status, code.as_deref()) {
        (403, _) => ApiError::AccessDenied,
        (409, Some("PLAYBACK_IN_USE")) => ApiError::PlaybackInUse { retry_after },
        (409, Some("PLAYBACK_LEASE_LOST")) => ApiError::PlaybackLeaseLost { retry_after },
        (409, _) => ApiError::QueueChanged,
        (status, _) => ApiError::Http {
            status,
            code,
            message,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn playback_conflict_messages_preserve_retry_hints() {
        assert_eq!(
            ApiError::PlaybackInUse {
                retry_after: Some(8)
            }
            .user_message(),
            "Playback is active on another device. Retry in 8s."
        );
        assert_eq!(
            ApiError::PlaybackLeaseLost {
                retry_after: Some(4)
            }
            .user_message(),
            "Playback moved to another device. Retry in 4s."
        );
    }
}
