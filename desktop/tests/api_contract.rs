use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
    time::Duration,
};

use async_trait::async_trait;
use dogmedia_desktop::{
    api::{ApiClient, ApiError, RawResponse, RequestSpec, Transport, TransportError},
    domain::{
        BrowseQuery, CategoryId, Cursor, DashboardQuery, Limit, MediaFilter, MediaId, Quality,
        SubtitleId,
    },
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
            category_id: Some(CategoryId::new(7)),
            liked: true,
            cursor: Some(Cursor::from("before/after")),
            limit: Limit::new(50),
        })
        .await
        .unwrap();
    assert_eq!(page.items[0].id, MediaId::new(9));
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
        .create_playback_session(MediaId::new(4), Quality::High)
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
async fn photo_stream_uses_a_session_and_releases_it_after_fetch_failure() {
    let transport = FakeTransport::scripted([
        FakeTransport::json(
            200,
            serde_json::json!({
                "streamUrl": "/api/media/7/stream?quality=high",
                "sessionId": "photo_session_abcdefghijklmnop",
                "viewerId": "viewer_abcdefghijklmnopqrst",
                "leaseRequired": false,
                "quality": "high"
            }),
        ),
        FakeTransport::json(500, serde_json::json!({"error": "stream failed"})),
        FakeTransport::json(200, serde_json::json!({"ok": true})),
    ]);
    let client = ApiClient::with_transport(
        "https://media.test",
        "viewer_abcdefghijklmnopqrst",
        transport.clone(),
    )
    .unwrap();

    assert!(matches!(
        client.photo(MediaId::new(7)).await,
        Err(ApiError::Http { status: 500, .. })
    ));

    let requests = transport.requests.lock().unwrap();
    assert_eq!(requests.len(), 3);
    assert_eq!(requests[0].url.path(), "/api/media/7/playback-session");
    assert_eq!(requests[1].url.path(), "/api/media/7/stream");
    assert_eq!(requests[2].url.path(), "/api/playback/lease");
    for request in &requests[1..] {
        assert_eq!(
            request.headers["X-Playback-Session"],
            "photo_session_abcdefghijklmnop"
        );
        assert_eq!(
            request.headers["X-Viewer-ID"],
            "viewer_abcdefghijklmnopqrst"
        );
    }
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
        client
            .create_playback_session(MediaId::new(1), Quality::High)
            .await,
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

#[tokio::test]
async fn queue_lyrics_and_subtitles_use_the_typed_transport_boundary() {
    let transport = FakeTransport::scripted([
        FakeTransport::json(
            200,
            serde_json::json!({
                "items": [{"id": 4, "title": "Queued", "mime_type": "audio/mpeg"}],
                "offset": 0,
                "total": 1,
                "currentIndex": 0,
                "currentMediaId": 4,
                "hasPrevious": false,
                "hasNext": false,
                "revision": 2
            }),
        ),
        FakeTransport::json(
            200,
            serde_json::json!({
                "mediaId": 4,
                "language": "en",
                "segments": [{"start": 0.0, "end": 1.0, "text": "Line"}]
            }),
        ),
        FakeTransport::json(
            200,
            serde_json::json!([{
                "id": 8,
                "language": "en",
                "title": "English",
                "vttUrl": "/api/media/4/subtitles/8/vtt",
                "assUrl": null
            }]),
        ),
        FakeTransport::json(200, serde_json::json!({"mediaId": 4})),
        FakeTransport::json(409, serde_json::json!({"error": "Queue changed"})),
    ]);
    let client = ApiClient::with_transport(
        "http://localhost:3001",
        "viewer_abcdefghijklmnopqrst",
        transport.clone(),
    )
    .unwrap();

    let queue = client.queue_window().await.unwrap();
    assert_eq!(queue.items[0].media.id, MediaId::new(4));
    assert_eq!(
        client
            .lyrics(MediaId::new(4))
            .await
            .unwrap()
            .unwrap()
            .segments[0]
            .text,
        "Line"
    );
    assert_eq!(
        client.subtitles(MediaId::new(4)).await.unwrap()[0].id,
        SubtitleId::new(8)
    );
    assert_eq!(
        client.queue_select(MediaId::new(4)).await.unwrap().media_id,
        Some(MediaId::new(4))
    );
    assert!(matches!(
        client.queue_clear().await,
        Err(ApiError::QueueChanged)
    ));

    let requests = transport.requests.lock().unwrap();
    assert_eq!(requests[0].url.path(), "/api/queue/window");
    assert_eq!(requests[1].url.path(), "/api/media/4/lyrics");
    assert_eq!(requests[2].url.path(), "/api/media/4/subtitles");
    assert_eq!(requests[3].url.path(), "/api/queue/select");
    assert_eq!(requests[3].json, Some(serde_json::json!({"mediaId": 4})));
    assert_eq!(requests[4].url.path(), "/api/queue");
}

#[tokio::test]
async fn missing_lyrics_is_an_empty_state() {
    let transport = FakeTransport::scripted([FakeTransport::json(
        404,
        serde_json::json!({"error": "Lyrics not found"}),
    )]);
    let client = ApiClient::with_transport(
        "http://localhost:3001",
        "viewer_abcdefghijklmnopqrst",
        transport,
    )
    .unwrap();
    assert!(client.lyrics(MediaId::new(9)).await.unwrap().is_none());
}

#[tokio::test]
async fn dashboard_and_thumbnail_use_typed_desktop_requests() {
    let transport = FakeTransport::scripted([
        FakeTransport::json(
            200,
            serde_json::json!({
                "featuredId": 12,
                "quickAccessIds": [12],
                "media": [{
                    "id": 12,
                    "title": "Featured",
                    "mime_type": "audio/mpeg",
                    "futureField": true
                }],
                "futureField": true
            }),
        ),
        Ok(RawResponse {
            status: 200,
            body: vec![0x52, 0x49, 0x46, 0x46],
        }),
    ]);
    let client = ApiClient::with_transport(
        "https://media.test/prefix",
        "viewer_abcdefghijklmnopqrst",
        transport.clone(),
    )
    .unwrap();

    let summary = client
        .dashboard(&DashboardQuery {
            liked: true,
            category_id: Some(CategoryId::new(7)),
            media_type: MediaFilter::Audio,
        })
        .await
        .unwrap();
    assert_eq!(summary.featured_id, Some(MediaId::new(12)));
    assert_eq!(summary.media[0].title(), "Featured");
    assert_eq!(
        client.media_thumbnail(MediaId::new(12)).await.unwrap(),
        vec![0x52, 0x49, 0x46, 0x46]
    );

    let requests = transport.requests.lock().unwrap();
    assert_eq!(requests[0].url.path(), "/prefix/api/playback/dashboard");
    let query: std::collections::HashMap<_, _> =
        requests[0].url.query_pairs().into_owned().collect();
    assert_eq!(query["view"], "liked");
    assert_eq!(query["category_id"], "7");
    assert_eq!(query["type"], "audio");
    assert_eq!(requests[1].url.path(), "/prefix/api/media/12/thumbnail");
    assert_eq!(requests[1].headers["X-Client-Platform"], "desktop");
    assert!(!requests[1].headers.contains_key("X-Playback-Session"));
}

#[tokio::test]
async fn missing_thumbnail_is_a_typed_http_error() {
    let transport = FakeTransport::scripted([FakeTransport::json(
        404,
        serde_json::json!({"error": "No thumbnail available"}),
    )]);
    let client = ApiClient::with_transport(
        "http://localhost:3001",
        "viewer_abcdefghijklmnopqrst",
        transport,
    )
    .unwrap();
    assert!(matches!(
        client.media_thumbnail(MediaId::new(99)).await,
        Err(ApiError::Http { status: 404, .. })
    ));
}
