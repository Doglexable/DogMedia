use std::fmt;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use url::Url;

use crate::domain::StreamPath;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum ServerUrlError {
    #[error("invalid server URL: {0}")]
    Invalid(String),
    #[error("server URL must use http or https")]
    UnsupportedScheme,
    #[error("server URL must include a host")]
    MissingHost,
}

/// Validated Dogmedia server origin (e.g. `https://media.example.com/`).
///
/// Guarantees: http/https scheme, a host, no query/fragment, trailing-slash
/// path so endpoint joins preserve any sub-path prefix.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerUrl(Url);

impl ServerUrl {
    pub const DEFAULT: &str = "http://localhost:3001/";

    pub fn parse(input: &str) -> Result<Self, ServerUrlError> {
        let mut url = Url::parse(input.trim()).map_err(|error| match error {
            url::ParseError::EmptyHost => ServerUrlError::MissingHost,
            other => ServerUrlError::Invalid(other.to_string()),
        })?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err(ServerUrlError::UnsupportedScheme);
        }
        if url.host_str().is_none() {
            return Err(ServerUrlError::MissingHost);
        }
        url.set_query(None);
        url.set_fragment(None);
        if !url.path().ends_with('/') {
            url.set_path(&format!("{}/", url.path()));
        }
        Ok(Self(url))
    }

    pub fn as_url(&self) -> &Url {
        &self.0
    }

    /// Join a typed API path onto the origin, preserving a sub-path prefix.
    pub fn join(&self, path: &str) -> Result<Url, ServerUrlError> {
        self.0
            .join(path.trim_start_matches('/'))
            .map_err(|error| ServerUrlError::Invalid(error.to_string()))
    }

    /// Join a server-relative [`StreamPath`] (stream / subtitle file URLs).
    pub fn join_stream(&self, path: &StreamPath) -> Result<Url, ServerUrlError> {
        self.join(path.as_str())
    }

    /// True for plain HTTP to a non-loopback host: allowed only with an
    /// explicit trusted-LAN confirmation.
    pub fn is_insecure_remote(&self) -> bool {
        self.0.scheme() == "http"
            && self.0.host_str().is_some_and(|host| {
                host != "localhost"
                    && host
                        .parse::<std::net::IpAddr>()
                        .map_or(true, |ip| !ip.is_loopback())
            })
    }
}

impl Default for ServerUrl {
    fn default() -> Self {
        Self::parse(Self::DEFAULT).expect("default server URL is valid")
    }
}

impl fmt::Display for ServerUrl {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl Serialize for ServerUrl {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.0.as_str())
    }
}

impl<'de> Deserialize<'de> for ServerUrl {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        // Fail safe: a stale or hand-edited config never breaks startup or
        // orphans the viewer identity — fall back to the default origin.
        Ok(Self::parse(&raw).unwrap_or_default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_prefix_and_strips_query_fragment() {
        let url = ServerUrl::parse("https://example.test/dogmedia?x=1#frag").unwrap();
        assert_eq!(url.to_string(), "https://example.test/dogmedia/");
        assert_eq!(
            url.join("api/check-access").unwrap().as_str(),
            "https://example.test/dogmedia/api/check-access"
        );
    }

    #[test]
    fn rejects_non_http_and_hostless_urls() {
        assert_eq!(
            ServerUrl::parse("ftp://example.test").unwrap_err(),
            ServerUrlError::UnsupportedScheme
        );
        assert_eq!(
            ServerUrl::parse("http://").unwrap_err(),
            ServerUrlError::MissingHost
        );
    }

    #[test]
    fn insecure_remote_detection_matches_loopback_rules() {
        assert!(
            ServerUrl::parse("http://192.168.1.8:3001")
                .unwrap()
                .is_insecure_remote()
        );
        assert!(
            !ServerUrl::parse("http://localhost:3001")
                .unwrap()
                .is_insecure_remote()
        );
        assert!(
            !ServerUrl::parse("http://127.0.0.1:3001")
                .unwrap()
                .is_insecure_remote()
        );
        assert!(
            !ServerUrl::parse("https://media.example.test")
                .unwrap()
                .is_insecure_remote()
        );
    }
}
