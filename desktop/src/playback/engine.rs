use std::str::FromStr;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
use std::time::{Duration, Instant};

use gst::prelude::*;
use gstreamer as gst;
use gstreamer_video::{VideoFormat, VideoInfo};
use thiserror::Error;

use crate::domain::{PlaybackSession, SessionId, ViewerId, Volume};

/// Frames handed from the GStreamer streaming thread to the render thread.
/// Compared against wgpu upload FPS to detect single-slot overwrites.
static PRODUCED_FRAMES: AtomicU64 = AtomicU64::new(0);

/// Total `new-sample` frames stored since process start.
pub fn produced_frames() -> u64 {
    PRODUCED_FRAMES.load(Ordering::Relaxed)
}

struct ProtectedHeaders {
    session_id: SessionId,
    viewer_id: ViewerId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EngineEvent {
    Ended,
    Failed(String),
}

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("GStreamer initialization failed: {0}")]
    Init(#[from] gst::glib::Error),
    #[error("required GStreamer element is unavailable: {0}")]
    MissingElement(&'static str),
    #[error("invalid stream URL")]
    InvalidStreamUrl,
    #[error("GStreamer state change failed: {0}")]
    State(#[from] gst::StateChangeError),
}

pub type RedrawCallback = Arc<dyn Fn() + Send + Sync + 'static>;

pub struct PlaybackEngine {
    playbin: gst::Element,
    video_sink: gst::Element,
    video_constraint: Arc<Mutex<Option<(u32, u32)>>>,
    caps_negotiating: Arc<AtomicBool>,
    small_resolution_since: Arc<Mutex<Option<Instant>>>,
    headers: Arc<Mutex<Option<ProtectedHeaders>>>,
    frame: Arc<Mutex<Option<VideoFrame>>>,
    recycle: Arc<Mutex<Vec<Vec<u8>>>>,
    redraw: Arc<Mutex<Option<RedrawCallback>>>,
    pending_seek: Arc<Mutex<Option<f64>>>,
    last_video_pts: Arc<Mutex<Option<f64>>>,
}

#[derive(Clone, Default)]
pub struct VideoFrameReceiver {
    frame: Arc<Mutex<Option<VideoFrame>>>,
    recycle: Arc<Mutex<Vec<Vec<u8>>>>,
}

impl VideoFrameReceiver {
    pub fn clear(&self) {
        if let Ok(mut frame) = self.frame.lock() {
            *frame = None;
        }
        if let Ok(mut recycle) = self.recycle.lock() {
            recycle.clear();
        }
    }

    pub fn take_frame(&self) -> Option<VideoFrame> {
        self.frame.lock().ok()?.take()
    }

    pub fn recycle_buffer(&self, buffer: Vec<u8>) {
        if let Ok(mut pool) = self.recycle.lock()
            && pool.len() < 4
        {
            pool.push(buffer);
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoPixelFormat {
    Nv12,
    Rgba,
}

#[derive(Debug, Clone)]
pub struct VideoFrame {
    pub width: u32,
    pub height: u32,
    pub format: VideoPixelFormat,
    pub pixels: Vec<u8>,
}

impl PlaybackEngine {
    pub fn new() -> Result<Self, EngineError> {
        Self::with_frame_receiver(VideoFrameReceiver::default())
    }

    pub fn with_frame_receiver(receiver: VideoFrameReceiver) -> Result<Self, EngineError> {
        gst::init()?;
        let playbin = gst::ElementFactory::make("playbin3")
            .build()
            .map_err(|_| EngineError::MissingElement("playbin3"))?;
        let video_sink = gst::ElementFactory::make("appsink")
            .build()
            .map_err(|_| EngineError::MissingElement("appsink"))?;
        let caps = gst::Caps::from_str("video/x-raw, format=(string){ NV12, RGBA }")
            .unwrap_or_else(|_| {
                gst::Caps::builder("video/x-raw")
                    .field("format", "RGBA")
                    .build()
            });
        video_sink.set_property("caps", &caps);
        // Keep sync=true (default) so video stays locked to the pipeline clock
        // for A/V sync. Setting sync=false would deliver frames as fast as the
        // decoder produces them and break lip-sync; frame drops from a slow
        // consumer are absorbed via max-buffers + drop instead. The renderer
        // keeps only the newest frame, so an appsink queue of four frames only
        // retains extra decoded video buffers when rendering falls behind.
        video_sink.set_property("sync", true);
        video_sink.set_property("max-buffers", 1_u32);
        video_sink.set_property("drop", true);
        // Let upstream decoders avoid work when this synchronized sink falls
        // behind. On-time playback is unaffected by QoS feedback.
        video_sink.set_property("qos", true);
        // VideoPaintSource owns the displayed texture; BaseSink's last-sample
        // cache would retain another decoded frame that the app never reads.
        video_sink.set_property("enable-last-sample", false);
        video_sink.set_property("emit-signals", true);
        receiver.clear();
        let frame = Arc::clone(&receiver.frame);
        let frame_target = Arc::clone(&frame);
        let recycle = Arc::clone(&receiver.recycle);
        let recycle_target = Arc::clone(&recycle);
        let redraw = Arc::new(Mutex::new(None::<RedrawCallback>));
        let redraw_target = Arc::clone(&redraw);
        let pending_seek = Arc::new(Mutex::new(None::<f64>));
        let last_video_pts = Arc::new(Mutex::new(None::<f64>));
        let last_video_pts_target = Arc::clone(&last_video_pts);
        let caps_negotiating = Arc::new(AtomicBool::new(false));
        let caps_negotiating_target = Arc::clone(&caps_negotiating);
        let small_resolution_since = Arc::new(Mutex::new(None::<Instant>));
        let small_resolution_since_target = Arc::clone(&small_resolution_since);

        video_sink.connect("new-sample", false, move |values| {
            caps_negotiating_target.store(false, Ordering::SeqCst);
            let sink = values.first()?.get::<gst::Element>().ok()?;
            let sample = sink.emit_by_name::<Option<gst::Sample>>("pull-sample", &[])?;
            let caps = sample.caps()?;
            let info = VideoInfo::from_caps(caps).ok()?;
            let buffer = sample.buffer()?;
            if let Some(pts) = buffer.pts()
                && let Ok(mut slot) = last_video_pts_target.lock()
            {
                *slot = Some(pts.nseconds() as f64 / 1_000_000_000.0);
            }
            let map = buffer.map_readable().ok()?;
            let width = info.width();
            let height = info.height();
            if width == 0 || height == 0 {
                return Some(gst::FlowReturn::Ok.to_value());
            }

            let (format, total_bytes) = match info.format() {
                VideoFormat::Nv12 => {
                    let uv_width = (width as usize).div_ceil(2);
                    let uv_height = (height as usize).div_ceil(2);
                    let y_total_bytes = width as usize * height as usize;
                    let uv_total_bytes = uv_width * 2 * uv_height;
                    (VideoPixelFormat::Nv12, y_total_bytes + uv_total_bytes)
                }
                VideoFormat::Rgba => (VideoPixelFormat::Rgba, width as usize * height as usize * 4),
                _ => return Some(gst::FlowReturn::Ok.to_value()),
            };

            let is_small = total_bytes <= 1_000_000;
            let in_grace_period = if is_small {
                let mut small_since = small_resolution_since_target.lock().ok();
                if let Some(ref mut slot) = small_since {
                    if slot.is_none() {
                        **slot = Some(Instant::now());
                    }
                    slot.as_ref()
                        .map(|t| t.elapsed() < Duration::from_secs(4))
                        .unwrap_or(false)
                } else {
                    false
                }
            } else {
                if let Ok(mut slot) = small_resolution_since_target.lock() {
                    *slot = None;
                }
                false
            };

            let mut pixels = recycle_target
                .lock()
                .ok()
                .and_then(|mut pool| {
                    if in_grace_period {
                        if let Some(idx) = pool.iter().position(|b| b.capacity() <= total_bytes * 2)
                        {
                            return Some(pool.remove(idx));
                        }
                        None
                    } else {
                        while let Some(buf) = pool.pop() {
                            if !is_small || buf.capacity() <= total_bytes * 2 {
                                return Some(buf);
                            }
                        }
                        None
                    }
                })
                .unwrap_or_else(|| Vec::with_capacity(total_bytes));

            pixels.clear();
            if pixels.capacity() < total_bytes {
                pixels.reserve(total_bytes - pixels.capacity());
            }

            let map_slice = map.as_slice();
            let copy_started = std::time::Instant::now();
            let mut slow_copy = false;
            match format {
                VideoPixelFormat::Nv12 => {
                    let y_width = width as usize;
                    let y_height = height as usize;
                    let y_stride = info.stride()[0].unsigned_abs() as usize;
                    let y_offset = info.offset()[0];
                    let y_total_bytes = y_width * y_height;

                    let uv_width = (width as usize).div_ceil(2);
                    let uv_height = (height as usize).div_ceil(2);
                    let uv_stride = info.stride()[1].unsigned_abs() as usize;
                    let uv_offset = info.offset()[1];
                    let uv_row_bytes = uv_width * 2;

                    if y_stride == y_width
                        && uv_stride == uv_row_bytes
                        && uv_offset == y_offset + y_total_bytes
                        && map_slice.len() >= y_offset + total_bytes
                    {
                        pixels.extend_from_slice(&map_slice[y_offset..y_offset + total_bytes]);
                    } else {
                        slow_copy = true;
                        if y_stride > 0 && map_slice.len() >= y_offset {
                            for row in map_slice[y_offset..].chunks(y_stride).take(y_height) {
                                pixels.extend_from_slice(&row[..y_width.min(row.len())]);
                            }
                        }
                        if uv_stride > 0 && map_slice.len() >= uv_offset {
                            for row in map_slice[uv_offset..].chunks(uv_stride).take(uv_height) {
                                pixels.extend_from_slice(&row[..uv_row_bytes.min(row.len())]);
                            }
                        }
                    }
                }
                VideoPixelFormat::Rgba => {
                    let row_bytes = width as usize * 4;
                    let stride = info.stride()[0].unsigned_abs() as usize;
                    let offset = info.offset()[0];
                    if stride == row_bytes && map_slice.len() >= offset + total_bytes {
                        pixels.extend_from_slice(&map_slice[offset..offset + total_bytes]);
                    } else if stride > 0 && map_slice.len() >= offset {
                        slow_copy = true;
                        for row in map_slice[offset..].chunks(stride).take(height as usize) {
                            pixels.extend_from_slice(&row[..row_bytes.min(row.len())]);
                        }
                    }
                }
            }

            if slow_copy {
                let elapsed = copy_started.elapsed();
                tracing::debug!(
                    target: "dogmedia_desktop::video",
                    width,
                    height,
                    elapsed_ms = elapsed.as_millis(),
                    "new-sample slow-path stride copy"
                );
            }

            if pixels.len() == total_bytes
                && let Ok(mut slot) = frame_target.lock()
            {
                if let Some(old) = slot.take()
                    && let Ok(mut pool) = recycle_target.lock()
                    && pool.len() < 4
                    && (in_grace_period || !is_small || old.pixels.capacity() <= total_bytes * 2)
                {
                    pool.push(old.pixels);
                }
                *slot = Some(VideoFrame {
                    width,
                    height,
                    format,
                    pixels,
                });
                PRODUCED_FRAMES.fetch_add(1, Ordering::Relaxed);
            }

            if let Ok(guard) = redraw_target.lock()
                && let Some(cb) = guard.as_ref()
            {
                cb();
            }

            Some(gst::FlowReturn::Ok.to_value())
        });
        playbin.set_property("video-sink", &video_sink);
        let headers = Arc::new(Mutex::new(None::<ProtectedHeaders>));
        let source_headers = Arc::clone(&headers);
        playbin.connect("source-setup", false, move |values| {
            let source = values
                .get(1)
                .and_then(|value| value.get::<gst::Element>().ok());
            if let Some(source) = source {
                if source.find_property("automatic-redirect").is_some() {
                    source.set_property("automatic-redirect", false);
                }
                if source.find_property("extra-headers").is_some()
                    && let Ok(headers) = source_headers.lock()
                    && let Some(headers) = headers.as_ref()
                {
                    let structure = gst::Structure::builder("headers")
                        .field("X-Playback-Session", headers.session_id.as_str())
                        .field("X-Viewer-ID", headers.viewer_id.as_str())
                        .field("X-Client-Platform", "desktop")
                        .build();
                    source.set_property("extra-headers", structure);
                }
            }
            None
        });
        let video_constraint = Arc::new(Mutex::new(None));
        Ok(Self {
            playbin,
            video_sink,
            video_constraint,
            caps_negotiating,
            small_resolution_since,
            headers,
            frame,
            recycle,
            redraw,
            pending_seek,
            last_video_pts,
        })
    }

    pub fn open(
        &self,
        session: &PlaybackSession,
        stream_url: &url::Url,
    ) -> Result<(), EngineError> {
        if !matches!(stream_url.scheme(), "http" | "https") {
            return Err(EngineError::InvalidStreamUrl);
        }
        if let Ok(mut headers) = self.headers.lock() {
            *headers = Some(ProtectedHeaders {
                session_id: session.session_id.clone(),
                viewer_id: session.viewer_id.clone(),
            });
        }
        if let Ok(mut pending) = self.pending_seek.lock() {
            *pending = None;
        }
        if let Ok(mut pts) = self.last_video_pts.lock() {
            *pts = None;
        }
        let _ = self.playbin.set_state(gst::State::Null);
        self.playbin.set_property("uri", "");
        self.playbin.set_property("uri", stream_url.as_str());
        self.clear_video_buffers();
        Ok(())
    }

    pub fn open_local(&self, file_url: &url::Url) -> Result<(), EngineError> {
        if file_url.scheme() != "file" {
            return Err(EngineError::InvalidStreamUrl);
        }
        if let Ok(mut headers) = self.headers.lock() {
            *headers = None;
        }
        if let Ok(mut pending) = self.pending_seek.lock() {
            *pending = None;
        }
        if let Ok(mut pts) = self.last_video_pts.lock() {
            *pts = None;
        }
        let _ = self.playbin.set_state(gst::State::Null);
        self.playbin.set_property("uri", "");
        self.playbin.set_property("uri", file_url.as_str());
        self.clear_video_buffers();
        Ok(())
    }

    fn clear_video_buffers(&self) {
        if let Ok(mut slot) = self.small_resolution_since.lock() {
            *slot = None;
        }
        self.caps_negotiating.store(false, Ordering::SeqCst);
        if let Ok(mut frame) = self.frame.lock() {
            *frame = None;
        }
        if let Ok(mut recycle) = self.recycle.lock() {
            recycle.clear();
        }
    }

    pub fn play(&self) -> Result<(), EngineError> {
        self.playbin.set_state(gst::State::Playing)?;
        Ok(())
    }

    pub fn pause(&self) -> Result<(), EngineError> {
        self.playbin.set_state(gst::State::Paused)?;
        Ok(())
    }

    pub fn is_playing(&self) -> bool {
        let (state_res, current, pending) = self.playbin.state(Some(gst::ClockTime::ZERO));
        state_res.is_ok() && (current == gst::State::Playing || pending == gst::State::Playing)
    }

    pub fn is_paused(&self) -> bool {
        let (state_res, current, pending) = self.playbin.state(Some(gst::ClockTime::ZERO));
        state_res.is_ok() && (current == gst::State::Paused || pending == gst::State::Paused)
    }

    pub fn stop(&self) -> Result<(), EngineError> {
        if let Ok(mut pending) = self.pending_seek.lock() {
            *pending = None;
        }
        if let Ok(mut pts) = self.last_video_pts.lock() {
            *pts = None;
        }
        self.playbin.set_state(gst::State::Null)?;
        // Null stops the pipeline but playbin may retain its source/decoder
        // graph and URI until the next open. Detach both here so Stop releases
        // demuxer/decoder buffers immediately; the next open installs a fresh
        // URI on the same configured playbin.
        self.playbin.set_property("uri", "");
        self.clear_video_buffers();
        if let Ok(mut headers) = self.headers.lock() {
            *headers = None;
        }
        Ok(())
    }

    pub fn flush_pending_seek(&self) {
        if let Ok(mut pending) = self.pending_seek.lock()
            && let Some(target) = *pending
        {
            let (state_res, current_state, pending_state) =
                self.playbin.state(Some(gst::ClockTime::ZERO));
            if state_res.is_ok()
                && current_state >= gst::State::Paused
                && pending_state == gst::State::VoidPending
            {
                let res = self.playbin.seek_simple(
                    gst::SeekFlags::FLUSH | gst::SeekFlags::KEY_UNIT,
                    gst::ClockTime::from_nseconds((target.max(0.0) * 1_000_000_000.0) as u64),
                );
                if res.is_ok() {
                    *pending = None;
                }
            }
        }
    }

    pub fn seek(&self, seconds: f64) -> bool {
        if let Ok(mut pts) = self.last_video_pts.lock() {
            *pts = Some(seconds);
        }
        let (state_res, current_state, pending_state) =
            self.playbin.state(Some(gst::ClockTime::ZERO));
        if state_res.is_ok()
            && current_state >= gst::State::Paused
            && pending_state == gst::State::VoidPending
        {
            self.playbin
                .seek_simple(
                    gst::SeekFlags::FLUSH | gst::SeekFlags::KEY_UNIT,
                    gst::ClockTime::from_nseconds((seconds.max(0.0) * 1_000_000_000.0) as u64),
                )
                .is_ok()
        } else {
            if let Ok(mut pending) = self.pending_seek.lock() {
                *pending = Some(seconds);
            }
            true
        }
    }

    pub fn position(&self) -> Option<f64> {
        self.flush_pending_seek();
        let query_pos = self
            .playbin
            .query_position::<gst::ClockTime>()
            .map(|value| value.nseconds() as f64 / 1_000_000_000.0);
        query_pos.or_else(|| self.last_video_pts.lock().ok().and_then(|guard| *guard))
    }

    pub fn duration(&self) -> Option<f64> {
        self.playbin
            .query_duration::<gst::ClockTime>()
            .map(|value| value.nseconds() as f64 / 1_000_000_000.0)
    }

    pub fn set_volume(&self, volume: Volume) {
        self.playbin.set_property("volume", volume.get());
    }

    pub fn set_muted(&self, muted: bool) {
        self.playbin.set_property("mute", muted);
    }

    pub fn set_subtitle_uri(&self, uri: Option<&str>) {
        self.playbin.set_property("suburi", uri);
    }

    pub fn set_redraw_callback(&self, callback: RedrawCallback) {
        if let Ok(mut slot) = self.redraw.lock() {
            *slot = Some(callback);
        }
    }

    pub fn set_video_constraint(&self, max_width: Option<u32>, max_height: Option<u32>) {
        let requested = match (max_width, max_height) {
            (Some(w), Some(h)) if w > 0 && h > 0 => Some((w, h)),
            _ => None,
        };
        if let Ok(mut current) = self.video_constraint.lock() {
            if *current == requested {
                return;
            }
            *current = requested;
        }

        // Defer if pipeline is actively in the middle of a caps negotiation cycle
        let is_playing = self.is_playing();
        if is_playing && self.caps_negotiating.load(Ordering::SeqCst) {
            return;
        }

        if is_playing {
            self.caps_negotiating.store(true, Ordering::SeqCst);
        }

        let caps = Self::build_caps(requested);
        self.video_sink.set_property("caps", &caps);
    }

    fn build_caps(constraint: Option<(u32, u32)>) -> gst::Caps {
        match constraint {
            Some((w, h)) => {
                gst::Caps::from_str(&format!(
                    "video/x-raw, format=(string){{ NV12, RGBA }}, width=(int)[ 1, {} ], height=(int)[ 1, {} ]",
                    w, h
                ))
                .unwrap_or_else(|_| {
                    gst::Caps::from_str("video/x-raw, format=(string){ NV12, RGBA }").unwrap()
                })
            }
            None => gst::Caps::from_str("video/x-raw, format=(string){ NV12, RGBA }").unwrap(),
        }
    }

    pub fn video_constraint(&self) -> Option<(u32, u32)> {
        self.video_constraint.lock().ok().and_then(|guard| *guard)
    }

    pub fn take_frame(&self) -> Option<VideoFrame> {
        self.frame.lock().ok()?.take()
    }

    pub fn frame_receiver(&self) -> VideoFrameReceiver {
        VideoFrameReceiver {
            frame: Arc::clone(&self.frame),
            recycle: Arc::clone(&self.recycle),
        }
    }

    pub fn poll_event(&self) -> Option<EngineEvent> {
        let bus = self.playbin.bus()?;
        let mut event = None;
        // Drain every message, including metadata/QoS/buffering messages that
        // are irrelevant to playback state. Filtering at the bus API leaves
        // those messages queued indefinitely and makes RSS grow on long runs.
        while let Some(message) = bus.timed_pop(gst::ClockTime::ZERO) {
            match message.view() {
                gst::MessageView::Eos(_) => {
                    if event.is_none() {
                        event = Some(EngineEvent::Ended);
                    }
                }
                gst::MessageView::Error(error) => {
                    if event.is_none() {
                        event = Some(EngineEvent::Failed(error.error().to_string()));
                    }
                }
                gst::MessageView::AsyncDone(_) => {
                    self.flush_pending_seek();
                }
                gst::MessageView::StateChanged(state)
                    if state.src().is_some_and(|s| s == &self.playbin)
                        && state.current() >= gst::State::Paused =>
                {
                    self.flush_pending_seek();
                }
                _ => {}
            }
        }
        self.flush_pending_seek();
        event
    }
}

impl Drop for PlaybackEngine {
    fn drop(&mut self) {
        let _ = self.playbin.set_state(gst::State::Null);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_open_accepts_only_file_urls() {
        let engine = PlaybackEngine::new().unwrap();
        assert!(matches!(
            engine.open_local(&url::Url::parse("https://example.com/media.mp3").unwrap()),
            Err(EngineError::InvalidStreamUrl)
        ));
        assert!(
            engine
                .open_local(&url::Url::parse("file:///missing.mp3").unwrap())
                .is_ok()
        );
    }

    #[test]
    fn synthetic_audio_pipeline_reaches_eos_without_display() {
        gst::init().unwrap();
        let pipeline = gst::parse::launch("audiotestsrc num-buffers=4 ! fakesink").unwrap();
        pipeline.set_state(gst::State::Playing).unwrap();
        let message = pipeline.bus().unwrap().timed_pop_filtered(
            gst::ClockTime::from_seconds(5),
            &[gst::MessageType::Eos, gst::MessageType::Error],
        );
        assert!(matches!(
            message.as_ref().map(|value| value.view()),
            Some(gst::MessageView::Eos(_))
        ));
        pipeline.set_state(gst::State::Null).unwrap();
    }

    #[test]
    fn deferred_seek_is_queued_and_flushed_without_error() {
        gst::init().unwrap();
        let engine = PlaybackEngine::new().unwrap();
        // Seeking when pipeline is Null or Ready must queue without error
        assert!(engine.seek(15.0));
        assert_eq!(*engine.pending_seek.lock().unwrap(), Some(15.0));
        // Stopping clears pending seek
        assert!(engine.stop().is_ok());
        assert_eq!(*engine.pending_seek.lock().unwrap(), None);
    }

    #[test]
    fn stop_detaches_uri_and_recycled_video_buffers() {
        gst::init().unwrap();
        let engine = PlaybackEngine::new().unwrap();
        engine
            .open_local(&url::Url::parse("file:///tmp/example.flac").unwrap())
            .unwrap();
        assert_eq!(
            engine.playbin.property::<Option<String>>("uri").as_deref(),
            Some("file:///tmp/example.flac")
        );
        engine.recycle.lock().unwrap().push(vec![1, 2, 3]);
        engine.frame.lock().unwrap().replace(VideoFrame {
            width: 1,
            height: 1,
            format: VideoPixelFormat::Rgba,
            pixels: vec![0; 4],
        });
        engine.stop().unwrap();
        assert!(engine.playbin.property::<String>("uri").is_empty());
        assert!(engine.recycle.lock().unwrap().is_empty());
        assert!(engine.frame.lock().unwrap().is_none());
    }

    #[test]
    fn opening_an_audio_track_releases_previous_video_buffers() {
        let engine = PlaybackEngine::new().unwrap();
        engine
            .open_local(&url::Url::parse("file:///tmp/video.mp4").unwrap())
            .unwrap();
        engine.recycle.lock().unwrap().push(vec![0; 2_304_000]);
        engine.frame.lock().unwrap().replace(VideoFrame {
            width: 1,
            height: 1,
            format: VideoPixelFormat::Rgba,
            pixels: vec![0; 4],
        });

        engine
            .open_local(&url::Url::parse("file:///tmp/audio.flac").unwrap())
            .unwrap();

        assert!(engine.recycle.lock().unwrap().is_empty());
        assert!(engine.frame.lock().unwrap().is_none());
    }

    #[test]
    fn video_frame_nv12_memory_is_62_5_percent_smaller_than_rgba() {
        let width = 1920_u32;
        let height = 800_u32;

        let rgba_bytes = (width * height * 4) as usize;
        assert_eq!(rgba_bytes, 6_144_000);

        let uv_width = (width as usize).div_ceil(2);
        let uv_height = (height as usize).div_ceil(2);
        let y_bytes = width as usize * height as usize;
        let uv_bytes = uv_width * 2 * uv_height;
        let nv12_bytes = y_bytes + uv_bytes;
        assert_eq!(nv12_bytes, 2_304_000);

        // Memory savings = (6_144_000 - 2_304_000) / 6_144_000 = 62.5%
        let saved_ratio = (rgba_bytes - nv12_bytes) as f64 / rgba_bytes as f64;
        assert!((saved_ratio - 0.625).abs() < 0.001);

        let frame = VideoFrame {
            width,
            height,
            format: VideoPixelFormat::Nv12,
            pixels: vec![0u8; nv12_bytes],
        };
        assert_eq!(frame.format, VideoPixelFormat::Nv12);
        assert_eq!(frame.pixels.len(), 2_304_000);
    }

    #[test]
    fn video_frame_receiver_buffers_are_recycled() {
        let receiver = VideoFrameReceiver::default();
        let buffer = vec![128u8; 2_304_000];
        receiver.recycle_buffer(buffer);
        assert_eq!(receiver.recycle.lock().unwrap().len(), 1);
        assert_eq!(receiver.recycle.lock().unwrap()[0].len(), 2_304_000);
        *receiver.frame.lock().unwrap() = Some(VideoFrame {
            width: 1,
            height: 1,
            format: VideoPixelFormat::Rgba,
            pixels: vec![0; 4],
        });
        receiver.clear();
        assert!(receiver.frame.lock().unwrap().is_none());
        assert!(receiver.recycle.lock().unwrap().is_empty());
    }

    #[test]
    fn replacement_engine_keeps_the_video_receiver_connected() {
        let receiver = VideoFrameReceiver::default();
        let first = PlaybackEngine::with_frame_receiver(receiver.clone()).unwrap();
        assert!(Arc::ptr_eq(&first.frame, &receiver.frame));
        drop(first);
        let replacement = PlaybackEngine::with_frame_receiver(receiver.clone()).unwrap();
        assert!(Arc::ptr_eq(&replacement.frame, &receiver.frame));
        assert!(Arc::ptr_eq(&replacement.recycle, &receiver.recycle));
    }

    #[test]
    fn set_video_constraint_updates_sink_caps_and_tracks_state() {
        let engine = PlaybackEngine::new().unwrap();
        assert_eq!(engine.video_constraint(), None);

        engine.set_video_constraint(Some(640), Some(360));
        assert_eq!(engine.video_constraint(), Some((640, 360)));
        let caps = engine.video_sink.property::<gst::Caps>("caps");
        let caps_str = caps.to_string();
        assert!(caps_str.contains("width=(int)[ 1, 640 ]"));
        assert!(caps_str.contains("height=(int)[ 1, 360 ]"));

        engine.set_video_constraint(None, None);
        assert_eq!(engine.video_constraint(), None);
        let caps = engine.video_sink.property::<gst::Caps>("caps");
        let caps_str = caps.to_string();
        assert!(!caps_str.contains("width="));
    }
}
