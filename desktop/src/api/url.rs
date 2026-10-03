use std::fmt;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use url::Url;

use crate::domain::StreamPath;

fn is_local_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(ip) => {
            let octets = ip.octets();
            ip.is_loopback()
                || ip.is_private()
                || ip.is_link_local()
                || ip.is_unspecified()
                // RFC 6598 shared address space, commonly used by Tailscale
                // and carrier-grade/private overlay networks.
                || (octets[0] == 100 && (64..=127).contains(&octets[1]))
        }
        std::net::IpAddr::V6(ip) => {
            ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_unicast_link_local()
                // RFC 4193 unique-local addresses (fc00::/7).
                || (ip.segments()[0] & 0xfe00) == 0xfc00
                || ip
                    .to_ipv4_mapped()
                    .is_some_and(|mapped| is_local_ip(mapped.into()))
        }
    }
}

fn is_local_host(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        return is_local_ip(ip);
    }

    host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".lan")
        || host.ends_with(".home.arpa")
        || !host.contains('.')
}

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

    pub fn as_str(&self) -> &str {
        self.0.as_str()
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

    /// True for plain HTTP to a public/non-local host. Loopback, private,
    /// link-local, overlay-network, and conventional LAN hostnames are local.
    pub fn is_insecure_remote(&self) -> bool {
        self.0.scheme() == "http" && self.0.host_str().is_some_and(|host| !is_local_host(host))
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
        for local in [
            "http://localhost:3001",
            "http://127.0.0.1:3001",
            "http://192.168.1.8:3001",
            "http://10.0.0.8:3001",
            "http://172.16.20.8:3001",
            "http://100.100.20.8:3001",
            "http://[fd12:3456::8]:3001",
            "http://dogmedia.local:3001",
            "http://dogmedia:3001",
        ] {
            assert!(
                !ServerUrl::parse(local).unwrap().is_insecure_remote(),
                "{local}"
            );
        }
        assert!(
            ServerUrl::parse("http://203.0.113.8:3001")
                .unwrap()
                .is_insecure_remote()
        );
        assert!(
            ServerUrl::parse("http://media.example.test")
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
