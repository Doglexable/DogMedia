use std::{collections::BTreeMap, sync::Arc, time::Duration};

use async_trait::async_trait;
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HttpMethod {
    Get,
    Post,
    Put,
    Delete,
}

impl From<HttpMethod> for reqwest::Method {
    fn from(value: HttpMethod) -> Self {
        match value {
            HttpMethod::Get => Self::GET,
            HttpMethod::Post => Self::POST,
            HttpMethod::Put => Self::PUT,
            HttpMethod::Delete => Self::DELETE,
        }
    }
}

#[derive(Clone)]
pub struct RequestSpec {
    pub method: HttpMethod,
    pub url: url::Url,
    pub headers: BTreeMap<String, String>,
    pub json: Option<serde_json::Value>,
    pub timeout: Duration,
}

#[derive(Debug, Clone)]
pub struct RawResponse {
    pub status: u16,
    pub body: Vec<u8>,
}

#[derive(Debug, Error, Clone)]
pub enum TransportError {
    #[error("request timed out")]
    Timeout,
    #[error("server could not be reached: {0}")]
    Unreachable(String),
}

#[async_trait]
pub trait Transport: Send + Sync {
    async fn execute(&self, request: RequestSpec) -> Result<RawResponse, TransportError>;
}

pub struct ReqwestTransport {
    client: reqwest::Client,
}

impl ReqwestTransport {
    pub fn new() -> Result<Arc<Self>, TransportError> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_millis(2_500))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| TransportError::Unreachable(error.to_string()))?;
        Ok(Arc::new(Self { client }))
    }
}

#[async_trait]
impl Transport for ReqwestTransport {
    async fn execute(&self, request: RequestSpec) -> Result<RawResponse, TransportError> {
        let mut builder = self
            .client
            .request(request.method.into(), request.url)
            .timeout(request.timeout);
        for (name, value) in request.headers {
            builder = builder.header(name, value);
        }
        if let Some(body) = request.json {
            builder = builder.json(&body);
        }
        let response = builder.send().await.map_err(map_reqwest)?;
        let status = response.status().as_u16();
        let body = response.bytes().await.map_err(map_reqwest)?.to_vec();
        Ok(RawResponse { status, body })
    }
}

fn map_reqwest(error: reqwest::Error) -> TransportError {
    if error.is_timeout() {
        TransportError::Timeout
    } else {
        TransportError::Unreachable(error.to_string())
    }
}
