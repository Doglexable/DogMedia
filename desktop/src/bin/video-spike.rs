use std::{
    env,
    sync::{OnceLock, mpsc},
    thread,
    time::{Duration, Instant},
};

use dioxus_native::{CustomPaintCtx, CustomPaintSource, DeviceHandle, TextureHandle, prelude::*};
use dogmedia_desktop::{
    api::ApiClient,
    domain::{
        BrowseQuery, Limit, MediaFilter, MediaId, PlaybackSession, Quality, SessionId, StreamPath,
        ViewerId,
    },
    playback::{EngineEvent, PlaybackEngine, VideoFrame},
};
use wgpu::{
    Extent3d, Origin3d, TexelCopyBufferLayout, TexelCopyTextureInfo, TextureAspect,
    TextureDescriptor, TextureDimension, TextureFormat, TextureUsages,
};

const REPORT_INTERVAL: Duration = Duration::from_secs(5);
const STYLES: &str = r#"
    html, body { margin: 0; width: 100%; height: 100%; background: #09090b; color: #fafafa; }
    body { font-family: sans-serif; }
    main { display: flex; flex-direction: column; width: 100%; height: 100%; }
    header { display: flex; align-items: center; justify-content: space-between; padding: 12px 18px; background: #18181b; }
    h1 { margin: 0; font-size: 17px; font-weight: 600; }
    p { margin: 0; color: #a1a1aa; font-size: 13px; }
    canvas { display: block; width: 100%; flex: 1; min-height: 0; background: #000; }
"#;

static CONFIG: OnceLock<SpikeConfig> = OnceLock::new();

enum SpikeConfig {
    Stream {
        stream_url: url::Url,
        session_id: SessionId,
        viewer_id: ViewerId,
    },
    Media {
        server_url: String,
        media_id: MediaId,
        quality: Quality,
        viewer_id: ViewerId,
    },
    Synthetic,
}

enum FrameSource {
    Engine {
        engine: PlaybackEngine,
        _lease: Option<SessionLease>,
        loop_on_eos: bool,
    },
    Synthetic {
        frame: VideoFrame,
        frame_index: u32,
        next_frame_at: Instant,
    },
}

struct SessionLease {
    shutdown: mpsc::Sender<()>,
    worker: Option<thread::JoinHandle<()>>,
}

impl SessionLease {
    fn spawn(
        runtime: tokio::runtime::Runtime,
        client: ApiClient,
        session: PlaybackSession,
    ) -> Self {
        let (shutdown, shutdown_rx) = mpsc::channel();
        let worker = thread::Builder::new()
            .name("video-spike-lease".to_owned())
            .spawn(move || {
                loop {
                    match shutdown_rx.recv_timeout(Duration::from_secs(10)) {
                        Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                        Err(mpsc::RecvTimeoutError::Timeout) if session.lease_required => {
                            if let Err(error) = runtime.block_on(client.heartbeat(&session)) {
                                eprintln!("video-spike: lease heartbeat failed: {error}");
                            }
                        }
                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                    }
                }
                if let Err(error) = runtime.block_on(client.release(&session)) {
                    eprintln!("video-spike: session release failed: {error}");
                }
            })
            .expect("failed to start the playback lease worker");
        Self {
            shutdown,
            worker: Some(worker),
        }
    }
}

impl Drop for SessionLease {
    fn drop(&mut self) {
        let _ = self.shutdown.send(());
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

impl FrameSource {
    fn from_config(config: &SpikeConfig) -> Self {
        match config {
            SpikeConfig::Stream {
                stream_url,
                session_id,
                viewer_id,
            } => {
                let engine =
                    PlaybackEngine::new().expect("failed to initialize the GStreamer engine");
                let session = PlaybackSession {
                    stream_url: StreamPath::new(stream_url.path()),
                    session_id: session_id.clone(),
                    viewer_id: viewer_id.clone(),
                    lease_required: false,
                    quality: Quality::Ori,
                    expires_at: None,
                };
                engine
                    .open(&session, stream_url)
                    .expect("failed to open the video stream");
                engine.play().expect("failed to start video playback");
                Self::Engine {
                    engine,
                    _lease: None,
                    loop_on_eos: false,
                }
            }
            SpikeConfig::Media {
                server_url,
                media_id,
                quality,
                viewer_id,
            } => {
                let runtime = tokio::runtime::Runtime::new()
                    .expect("failed to initialize the playback API runtime");
                let client = ApiClient::new(server_url, viewer_id.clone())
                    .expect("failed to initialize the playback API client");
                let session = runtime
                    .block_on(client.create_playback_session(*media_id, *quality))
                    .expect("failed to create a protected playback session");
                let stream_url = client
                    .absolute_url(&session.stream_url)
                    .expect("server returned an invalid stream URL");
                probe_protected_stream(&runtime, &session, &stream_url);
                let engine =
                    PlaybackEngine::new().expect("failed to initialize the GStreamer engine");
                engine
                    .open(&session, &stream_url)
                    .expect("failed to open the video stream");
                engine.play().expect("failed to start video playback");
                let lease = SessionLease::spawn(runtime, client, session);
                Self::Engine {
                    engine,
                    _lease: Some(lease),
                    loop_on_eos: true,
                }
            }
            SpikeConfig::Synthetic => Self::Synthetic {
                frame: synthetic_1080p_frame(),
                frame_index: 0,
                next_frame_at: Instant::now(),
            },
        }
    }

    fn take_frame(&mut self) -> Option<VideoFrame> {
        match self {
            Self::Engine { engine, .. } => engine.take_frame(),
            Self::Synthetic {
                frame,
                frame_index,
                next_frame_at,
            } => {
                let now = Instant::now();
                if now < *next_frame_at {
                    return None;
                }
                *next_frame_at += Duration::from_secs_f64(1.0 / 24.0);
                if *next_frame_at < now {
                    *next_frame_at = now + Duration::from_secs_f64(1.0 / 24.0);
                }
                let mut output = frame.clone();
                draw_synthetic_motion(&mut output, *frame_index);
                *frame_index = frame_index.wrapping_add(1);
                Some(output)
            }
        }
    }

    fn poll_event(&self) -> Option<EngineEvent> {
        match self {
            Self::Engine { engine, .. } => engine.poll_event(),
            Self::Synthetic { .. } => None,
        }
    }

    fn timing(&self) -> (Option<f64>, Option<f64>) {
        match self {
            Self::Engine { engine, .. } => (engine.position(), engine.duration()),
            Self::Synthetic { .. } => (None, None),
        }
    }

    fn restart_after_eos(&self) -> bool {
        match self {
            Self::Engine {
                engine,
                loop_on_eos: true,
                ..
            } => engine.seek(0.0) && engine.play().is_ok(),
            _ => false,
        }
    }

    const fn label(&self) -> &'static str {
        match self {
            Self::Engine { .. } => "GStreamer single-slot handoff",
            Self::Synthetic { .. } => "synthetic 1080p24 source",
        }
    }
}

struct VideoPaintSource {
    source: FrameSource,
    device: Option<wgpu::Device>,
    queue: Option<wgpu::Queue>,
    texture: Option<wgpu::Texture>,
    texture_handle: Option<TextureHandle>,
    texture_size: Option<(u32, u32)>,
    started_at: Instant,
    report_started_at: Instant,
    uploaded_frames: u64,
    interval_frames: u64,
    invalid_frames: u64,
    terminal_event_reported: bool,
    wait_reported_at: Instant,
}

impl VideoPaintSource {
    fn new() -> Self {
        let config = CONFIG
            .get()
            .expect("video spike config must be initialized");
        let source = FrameSource::from_config(config);

        let now = Instant::now();
        Self {
            source,
            device: None,
            queue: None,
            texture: None,
            texture_handle: None,
            texture_size: None,
            started_at: now,
            report_started_at: now,
            uploaded_frames: 0,
            interval_frames: 0,
            invalid_frames: 0,
            terminal_event_reported: false,
            wait_reported_at: now,
        }
    }

    fn report_terminal_event(&mut self) {
        if self.terminal_event_reported {
            return;
        }
        match self.source.poll_event() {
            Some(EngineEvent::Ended) => {
                if self.source.restart_after_eos() {
                    eprintln!("video-spike: stream ended; looping benchmark media");
                } else {
                    eprintln!("video-spike: stream ended");
                    self.terminal_event_reported = true;
                }
            }
            Some(EngineEvent::Failed(error)) => {
                eprintln!("video-spike: playback failed: {error}");
                self.terminal_event_reported = true;
            }
            None => {}
        }
    }

    fn ensure_placeholder(&mut self, mut ctx: CustomPaintCtx<'_>) -> Option<TextureHandle> {
        if self.texture_handle.is_some() {
            return self.texture_handle.clone();
        }
        let device = self.device.as_ref()?;
        let queue = self.queue.as_ref()?;
        let texture = device.create_texture(&TextureDescriptor {
            label: Some("dogmedia-video-spike-placeholder"),
            size: Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: TextureDimension::D2,
            format: TextureFormat::Rgba8Unorm,
            usage: TextureUsages::TEXTURE_BINDING
                | TextureUsages::COPY_DST
                | TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        queue.write_texture(
            TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: Origin3d::ZERO,
                aspect: TextureAspect::All,
            },
            &[0, 0, 0, 255],
            TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(4),
                rows_per_image: Some(1),
            },
            Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
        );
        self.texture_handle = Some(ctx.register_texture(texture.clone()));
        self.texture = Some(texture);
        self.texture_size = Some((1, 1));
        eprintln!("video-spike: waiting for the first decoded frame");
        self.texture_handle.clone()
    }

    fn report_waiting_if_due(&mut self) {
        if self.uploaded_frames > 0 || self.wait_reported_at.elapsed() < REPORT_INTERVAL {
            return;
        }
        let (position, duration) = self.source.timing();
        eprintln!(
            "video-spike: still waiting for a decoded video frame; position={position:?}, duration={duration:?}"
        );
        self.wait_reported_at = Instant::now();
    }

    fn upload_frame(
        &mut self,
        mut ctx: CustomPaintCtx<'_>,
        frame: VideoFrame,
    ) -> Option<TextureHandle> {
        let expected_len = frame.width as usize * frame.height as usize * 4;
        if frame.width == 0 || frame.height == 0 || frame.pixels.len() != expected_len {
            self.invalid_frames += 1;
            return self.texture_handle.clone();
        }

        if self.texture_size != Some((frame.width, frame.height)) {
            if let Some(handle) = self.texture_handle.take() {
                ctx.unregister_texture(handle);
            }
            let device = self.device.as_ref()?;
            let texture = device.create_texture(&TextureDescriptor {
                label: Some("dogmedia-video-spike-frame"),
                size: Extent3d {
                    width: frame.width,
                    height: frame.height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: TextureDimension::D2,
                // Vello copies registered textures into its image atlas each frame.
                // Its contract requires linear RGBA8 plus COPY_SRC.
                format: TextureFormat::Rgba8Unorm,
                usage: TextureUsages::TEXTURE_BINDING
                    | TextureUsages::COPY_DST
                    | TextureUsages::COPY_SRC,
                view_formats: &[],
            });
            self.texture_handle = Some(ctx.register_texture(texture.clone()));
            self.texture = Some(texture);
            self.texture_size = Some((frame.width, frame.height));
            eprintln!(
                "video-spike: source is {}x{} RGBA",
                frame.width, frame.height
            );
        }

        let texture = self.texture.as_ref()?;
        let queue = self.queue.as_ref()?;
        queue.write_texture(
            TexelCopyTextureInfo {
                texture,
                mip_level: 0,
                origin: Origin3d::ZERO,
                aspect: TextureAspect::All,
            },
            &frame.pixels,
            TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(frame.width * 4),
                rows_per_image: Some(frame.height),
            },
            Extent3d {
                width: frame.width,
                height: frame.height,
                depth_or_array_layers: 1,
            },
        );
        if self.uploaded_frames == 0 {
            let now = Instant::now();
            self.started_at = now;
            self.report_started_at = now;
        }
        self.uploaded_frames += 1;
        self.interval_frames += 1;
        self.report_if_due();
        self.texture_handle.clone()
    }

    fn report_if_due(&mut self) {
        let elapsed = self.report_started_at.elapsed();
        if elapsed < REPORT_INTERVAL {
            return;
        }
        let interval_fps = self.interval_frames as f64 / elapsed.as_secs_f64();
        let average_fps = self.uploaded_frames as f64 / self.started_at.elapsed().as_secs_f64();
        eprintln!(
            "video-spike: {interval_fps:.1} fps (average {average_fps:.1}), {} frames uploaded, {} invalid; source = {}",
            self.uploaded_frames,
            self.invalid_frames,
            self.source.label()
        );
        self.interval_frames = 0;
        self.report_started_at = Instant::now();
    }
}

impl CustomPaintSource for VideoPaintSource {
    fn resume(&mut self, device_handle: &DeviceHandle) {
        self.device = Some(device_handle.device.clone());
        self.queue = Some(device_handle.queue.clone());
    }

    fn suspend(&mut self) {
        self.texture = None;
        self.texture_handle = None;
        self.texture_size = None;
        self.device = None;
        self.queue = None;
    }

    fn render(
        &mut self,
        ctx: CustomPaintCtx<'_>,
        _width: u32,
        _height: u32,
        _scale: f64,
    ) -> Option<TextureHandle> {
        self.report_terminal_event();
        self.report_waiting_if_due();
        match self.source.take_frame() {
            Some(frame) => self.upload_frame(ctx, frame),
            None if self.texture_handle.is_some() => self.texture_handle.clone(),
            None => self.ensure_placeholder(ctx),
        }
    }
}

fn synthetic_1080p_frame() -> VideoFrame {
    const WIDTH: u32 = 1920;
    const HEIGHT: u32 = 1080;
    let mut pixels = Vec::with_capacity(WIDTH as usize * HEIGHT as usize * 4);
    for y in 0..HEIGHT {
        for x in 0..WIDTH {
            pixels.extend_from_slice(&[
                (x * 255 / WIDTH) as u8,
                (y * 255 / HEIGHT) as u8,
                160,
                255,
            ]);
        }
    }
    VideoFrame {
        width: WIDTH,
        height: HEIGHT,
        pixels,
    }
}

fn draw_synthetic_motion(frame: &mut VideoFrame, frame_index: u32) {
    const BAND_WIDTH: u32 = 48;
    let band_start = frame_index.wrapping_mul(12) % frame.width;
    for y in 0..frame.height {
        for offset in 0..BAND_WIDTH {
            let x = (band_start + offset) % frame.width;
            let pixel = ((y * frame.width + x) * 4) as usize;
            frame.pixels[pixel..pixel + 4].copy_from_slice(&[250, 250, 250, 255]);
        }
    }
}

fn app() -> Element {
    let source_id = dioxus_native::use_wgpu(VideoPaintSource::new);
    rsx! {
        style { {STYLES} }
        main {
            header {
                h1 { "Dogmedia · Blitz video spike" }
                p { "RGBA appsink → WGPU texture · metrics print every 5 seconds" }
            }
            canvas { "src": "{source_id}" }
        }
    }
}

fn validate_video_media(server_url: &str, media_id: MediaId, viewer_id: &ViewerId) {
    let runtime = tokio::runtime::Runtime::new().unwrap_or_else(|error| {
        eprintln!("video-spike: failed to initialize the playback API runtime: {error}");
        std::process::exit(1);
    });
    let client = ApiClient::new(server_url, viewer_id.clone()).unwrap_or_else(|error| {
        eprintln!("video-spike: failed to initialize the playback API client: {error}");
        std::process::exit(2);
    });
    let media = runtime
        .block_on(client.media(media_id))
        .unwrap_or_else(|error| {
            eprintln!("video-spike: failed to load media {media_id}: {error}");
            std::process::exit(1);
        });
    eprintln!(
        "video-spike: media {} is {:?} ({})",
        media.id,
        media.title(),
        media.mime_type.as_deref().unwrap_or("unknown MIME type")
    );
    if media.is_video() {
        return;
    }

    eprintln!("video-spike: media {media_id} is not a video");
    let query = BrowseQuery {
        media_type: MediaFilter::Video,
        limit: Limit::new(10),
        ..BrowseQuery::default()
    };
    if let Ok(page) = runtime.block_on(client.browse(&query)) {
        if page.items.is_empty() {
            eprintln!("video-spike: no accessible videos were found");
        } else {
            eprintln!("video-spike: try one of these accessible video IDs:");
            for video in page.items {
                eprintln!("  {}\t{}", video.id, video.title());
            }
        }
    }
    std::process::exit(2);
}

fn probe_protected_stream(
    runtime: &tokio::runtime::Runtime,
    session: &PlaybackSession,
    stream_url: &url::Url,
) {
    let result = runtime.block_on(async {
        let mut response = reqwest::Client::new()
            .get(stream_url.clone())
            .header("Range", "bytes=0-4095")
            .header("X-Playback-Session", session.session_id.as_str())
            .header("X-Viewer-ID", session.viewer_id.as_str())
            .header("X-Client-Platform", "desktop")
            .send()
            .await?;
        let status = response.status();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("missing")
            .to_owned();
        let content_range = response
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("missing")
            .to_owned();
        let actual_quality = response
            .headers()
            .get("X-Media-Quality")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("missing")
            .to_owned();
        let first_chunk_len = response.chunk().await?.map_or(0, |chunk| chunk.len());
        Ok::<_, reqwest::Error>((
            status,
            content_type,
            content_range,
            actual_quality,
            first_chunk_len,
        ))
    });
    match result {
        Ok((status, content_type, content_range, actual_quality, first_chunk_len)) => eprintln!(
            "video-spike: stream probe status={status}, type={content_type}, range={content_range}, actual_quality={actual_quality}, first_chunk={first_chunk_len} bytes"
        ),
        Err(error) => eprintln!("video-spike: stream probe failed: {error}"),
    }
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .without_time()
        .init();

    let mut args = env::args().skip(1);
    let Some(raw_url) = args.next() else {
        eprintln!(
            "usage: video-spike --synthetic\n       video-spike --media <server-url> <media-id> [quality] [viewer-id]\n       video-spike <stream-url> [session-id] [viewer-id]"
        );
        std::process::exit(2);
    };
    let config = if raw_url == "--synthetic" {
        SpikeConfig::Synthetic
    } else if raw_url == "--media" {
        let server_url = args.next().unwrap_or_else(|| {
            eprintln!("video-spike: --media requires <server-url> and <media-id>");
            std::process::exit(2);
        });
        let media_id = args
            .next()
            .unwrap_or_else(|| {
                eprintln!("video-spike: --media requires <server-url> and <media-id>");
                std::process::exit(2);
            })
            .parse::<MediaId>()
            .unwrap_or_else(|error| {
                eprintln!("video-spike: invalid media ID: {error}");
                std::process::exit(2);
            });
        let quality = args
            .next()
            .map(|value| {
                value.parse::<Quality>().unwrap_or_else(|error| {
                    eprintln!("video-spike: invalid quality: {error}");
                    std::process::exit(2);
                })
            })
            .unwrap_or(Quality::Ori);
        let viewer_id = ViewerId::new(
            args.next()
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        );
        validate_video_media(&server_url, media_id, &viewer_id);
        SpikeConfig::Media {
            server_url,
            media_id,
            quality,
            viewer_id,
        }
    } else {
        let stream_url = url::Url::parse(&raw_url).unwrap_or_else(|error| {
            eprintln!("video-spike: invalid stream URL: {error}");
            std::process::exit(2);
        });
        let session_id = SessionId::new(args.next().unwrap_or_else(|| "video-spike".to_owned()));
        let viewer_id = ViewerId::new(args.next().unwrap_or_else(|| "video-spike".to_owned()));
        SpikeConfig::Stream {
            stream_url,
            session_id,
            viewer_id,
        }
    };
    CONFIG
        .set(config)
        .unwrap_or_else(|_| unreachable!("video spike config is initialized only once"));

    dioxus_native::launch(app);
}
