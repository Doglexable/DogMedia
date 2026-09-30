use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
    time::Duration,
};

use async_trait::async_trait;
use dogmedia_desktop::{
    api::{ApiClient, ApiError, RawResponse, RequestSpec, Transport, TransportError},
    domain::{BrowseQuery, Quality},
};

#[derive(Default)]
struct FakeTransport {
    requests: Mutex<Vec<RequestSpec>>,
    responses: Mutex<VecDeque<Result<RawResponse, TransportError>>>,
}

impl FakeTransport {
    fn scripted(
        responses: impl IntoIterator<Item = Result<RawResponse, TransportError>>,
    ) -> Arc<Self> {
        Arc::new(Self {
            requests: Mutex::new(Vec::new()),
            responses: Mutex::new(responses.into_iter().collect()),
        })
    }

    fn json(status: u16, value: serde_json::Value) -> Result<RawResponse, TransportError> {
        Ok(RawResponse {
            status,
            body: serde_json::to_vec(&value).unwrap(),
        })
    }
}

#[async_trait]
impl Transport for FakeTransport {
    async fn execute(&self, request: RequestSpec) -> Result<RawResponse, TransportError> {
        self.requests.lock().unwrap().push(request);
        self.responses
            .lock()
            .unwrap()
            .pop_front()
            .expect("scripted response")
    }
}

#[tokio::test]
async fn access_request_preserves_prefix_and_sends_desktop_identity() {
    let transport = FakeTransport::scripted([FakeTransport::json(
        200,
        serde_json::json!({
            "tier": 100, "firstRun": false, "ip": "127.0.0.1"
        }),
    )]);
    let client = ApiClient::with_transport(
        "https://example.test/dogmedia",
        "viewer_abcdefghijklmnopqrst",
        transport.clone(),
    )
    .unwrap();
    let access = client.check_access().await.unwrap();
    assert_eq!(access.tier, 100);
    let requests = transport.requests.lock().unwrap();
    let request = &requests[0];
    assert_eq!(
        request.url.as_str(),
        "https://example.test/dogmedia/api/check-access"
    );
    assert_eq!(request.headers["X-Client-Platform"], "desktop");
    assert_eq!(
        request.headers["X-Viewer-ID"],
        "viewer_abcdefghijklmnopqrst"
    );
    assert_eq!(request.timeout, Duration::from_millis(2_500));
}

#[tokio::test]
async fn browse_encodes_filters_and_ignores_additive_fields() {
    let transport = FakeTransport::scripted([FakeTransport::json(
        200,
        serde_json::json!({
            "items": [{"id": 9, "title": "Track", "futureField": true}], "nextCursor": "cursor"
        }),
    )]);
    let client = ApiClient::with_transport(
        "http://localhost:3001",
        "viewer_abcdefghijklmnopqrst",
        transport.clone(),
    )
    .unwrap();
    let page = client
        .browse(&BrowseQuery {
            search: "a & b".into(),
            media_type: dogmedia_desktop::domain::MediaFilter::Audio,
            category_id: Some(7),
            liked: true,
            cursor: Some("before/after".into()),
            limit: 50,
        })
        .await
        .unwrap();
    assert_eq!(page.items[0].id, 9);
    let requests = transport.requests.lock().unwrap();
    let query: std::collections::HashMap<_, _> =
        requests[0].url.query_pairs().into_owned().collect();
    assert_eq!(query["q"], "a & b");
    assert_eq!(query["type"], "audio");
    assert_eq!(query["category_id"], "7");
    assert_eq!(query["view"], "liked");
    assert_eq!(query["cursor"], "before/after");
}

#[tokio::test]
async fn playback_session_and_heartbeat_use_protected_headers_not_urls() {
    let transport = FakeTransport::scripted([
        FakeTransport::json(
            200,
            serde_json::json!({
                "streamUrl": "/api/media/4/stream?quality=high",
                "sessionId": "secret_session_abcdefghijklmnop",
                "viewerId": "viewer_abcdefghijklmnopqrst",
                "leaseRequired": true,
                "quality": "high"
            }),
        ),
        FakeTransport::json(200, serde_json::json!({"ok": true})),
    ]);
    let client = ApiClient::with_transport(
        "https://media.test",
        "viewer_abcdefghijklmnopqrst",
        transport.clone(),
    )
    .unwrap();
    let session = client
        .create_playback_session(4, Quality::High)
        .await
        .unwrap();
    client.heartbeat(&session).await.unwrap();
    let requests = transport.requests.lock().unwrap();
    assert_eq!(
        requests[0].json,
        Some(serde_json::json!({"quality": "high"}))
    );
    assert!(!requests[0].url.as_str().contains("secret_session"));
    assert_eq!(
        requests[1].headers["X-Playback-Session"],
        "secret_session_abcdefghijklmnop"
    );
    assert_eq!(
        requests[1].headers["X-Viewer-ID"],
        "viewer_abcdefghijklmnopqrst"
    );
    assert!(!requests[1].url.as_str().contains("secret_session"));
}

#[tokio::test]
async fn typed_errors_cover_denial_conflict_timeout_and_malformed_payload() {
    let transport = FakeTransport::scripted([
        FakeTransport::json(403, serde_json::json!({"error": "denied"})),
        FakeTransport::json(
            409,
            serde_json::json!({"code": "PLAYBACK_IN_USE", "retryAfter": 8}),
        ),
        Err(TransportError::Timeout),
        Ok(RawResponse {
            status: 200,
            body: b"not-json".to_vec(),
        }),
    ]);
    let client = ApiClient::with_transport(
        "http://localhost:3001",
        "viewer_abcdefghijklmnopqrst",
        transport,
    )
    .unwrap();
    assert!(matches!(
        client.check_access().await,
        Err(ApiError::AccessDenied)
    ));
    assert!(matches!(
        client.create_playback_session(1, Quality::High).await,
        Err(ApiError::PlaybackInUse {
            retry_after: Some(8)
        })
    ));
    assert!(matches!(client.categories().await, Err(ApiError::Timeout)));
    assert!(matches!(
        client.categories().await,
        Err(ApiError::Malformed(_))
    ));
}
