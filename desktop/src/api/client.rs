use std::{collections::BTreeMap, sync::Arc, time::Duration};

use serde::{Serialize, de::DeserializeOwned};
use thiserror::Error;
use url::Url;

use super::transport::{
    HttpMethod, RawResponse, RequestSpec, ReqwestTransport, Transport, TransportError,
};

#[derive(Debug, Error)]
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
    #[error("server returned {status}: {message}")]
    Http {
        status: u16,
        code: Option<String>,
        message: String,
    },
    #[error("server response was malformed: {0}")]
    Malformed(String),
}

impl From<TransportError> for ApiError {
    fn from(value: TransportError) -> Self {
        match value {
            TransportError::Timeout => Self::Timeout,
            TransportError::Unreachable(message) => Self::Unreachable(message),
        }
    }
}

#[derive(Clone)]
pub struct ApiClient {
    base_url: Url,
    viewer_id: String,
    transport: Arc<dyn Transport>,
}

impl ApiClient {
    pub fn new(base_url: &str, viewer_id: impl Into<String>) -> Result<Self, ApiError> {
        Self::with_transport(base_url, viewer_id, ReqwestTransport::new()?)
    }

    pub fn with_transport(
        base_url: &str,
        viewer_id: impl Into<String>,
        transport: Arc<dyn Transport>,
    ) -> Result<Self, ApiError> {
        let mut base_url = Url::parse(base_url.trim())?;
        if !matches!(base_url.scheme(), "http" | "https") {
            return Err(ApiError::UnsupportedScheme);
        }
        if base_url.host_str().is_none() {
            return Err(ApiError::InvalidUrl(url::ParseError::EmptyHost));
        }
        base_url.set_query(None);
        base_url.set_fragment(None);
        if !base_url.path().ends_with('/') {
            base_url.set_path(&format!("{}/", base_url.path()));
        }
        Ok(Self {
            base_url,
            viewer_id: viewer_id.into(),
            transport,
        })
    }

    pub fn base_url(&self) -> &Url {
        &self.base_url
    }

    pub fn viewer_id(&self) -> &str {
        &self.viewer_id
    }

    pub fn absolute_url(&self, path: &str) -> Result<Url, ApiError> {
        Ok(self.base_url.join(path.trim_start_matches('/'))?)
    }

    pub fn is_insecure_remote(&self) -> bool {
        self.base_url.scheme() == "http"
            && self.base_url.host_str().is_some_and(|host| {
                host != "localhost"
                    && host
                        .parse::<std::net::IpAddr>()
                        .map_or(true, |ip| !ip.is_loopback())
            })
    }

    pub(crate) async fn json<T, B>(
        &self,
        method: HttpMethod,
        path: &str,
        body: Option<&B>,
        session: Option<(&str, &str)>,
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

    pub(crate) async fn bytes(
        &self,
        method: HttpMethod,
        path: &str,
        session: Option<(&str, &str)>,
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
        session: Option<(&str, &str)>,
        timeout: Duration,
    ) -> Result<RawResponse, ApiError> {
        let mut headers = BTreeMap::from([
            ("Accept".to_owned(), "application/json".to_owned()),
            ("X-Client-Platform".to_owned(), "desktop".to_owned()),
            ("X-Viewer-ID".to_owned(), self.viewer_id.clone()),
        ]);
        if body.is_some() {
            headers.insert("Content-Type".to_owned(), "application/json".to_owned());
        }
        if let Some((session_id, viewer_id)) = session {
            headers.insert("X-Playback-Session".to_owned(), session_id.to_owned());
            headers.insert("X-Viewer-ID".to_owned(), viewer_id.to_owned());
        }
        let request = RequestSpec {
            method,
            url: self.absolute_url(path)?,
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
