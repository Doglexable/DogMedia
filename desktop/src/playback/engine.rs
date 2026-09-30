use std::sync::{Arc, Mutex};

use gst::prelude::*;
use gstreamer as gst;
use thiserror::Error;

use crate::domain::PlaybackSession;

struct ProtectedHeaders {
    session_id: String,
    viewer_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EngineEvent {
    Ended,
    Failed(String),
}

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("GStreamer initialization failed: {0}")]
    Init(#[from] glib::Error),
    #[error("required GStreamer element is unavailable: {0}")]
    MissingElement(&'static str),
    #[error("invalid stream URL")]
    InvalidStreamUrl,
    #[error("GStreamer state change failed: {0}")]
    State(#[from] gst::StateChangeError),
}

pub struct PlaybackEngine {
    playbin: gst::Element,
    video_sink: gst::Element,
    headers: Arc<Mutex<Option<ProtectedHeaders>>>,
}

impl PlaybackEngine {
    pub fn new() -> Result<Self, EngineError> {
        gst::init()?;
        let playbin = gst::ElementFactory::make("playbin3")
            .build()
            .map_err(|_| EngineError::MissingElement("playbin3"))?;
        let video_sink = gst::ElementFactory::make("gtk4paintablesink")
            .build()
            .map_err(|_| EngineError::MissingElement("gtk4paintablesink"))?;
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
        Ok(Self {
            playbin,
            video_sink,
            headers,
        })
    }

    pub fn open(&self, session: &PlaybackSession, stream_url: &str) -> Result<(), EngineError> {
        if !stream_url.starts_with("http://") && !stream_url.starts_with("https://") {
            return Err(EngineError::InvalidStreamUrl);
        }
        if let Ok(mut headers) = self.headers.lock() {
            *headers = Some(ProtectedHeaders {
                session_id: session.session_id.clone(),
                viewer_id: session.viewer_id.clone(),
            });
        }
        self.playbin.set_property("uri", stream_url);
        Ok(())
    }

    pub fn play(&self) -> Result<(), EngineError> {
        self.playbin.set_state(gst::State::Playing)?;
        Ok(())
    }

    pub fn pause(&self) -> Result<(), EngineError> {
        self.playbin.set_state(gst::State::Paused)?;
        Ok(())
    }

    pub fn stop(&self) -> Result<(), EngineError> {
        self.playbin.set_state(gst::State::Null)?;
        if let Ok(mut headers) = self.headers.lock() {
            *headers = None;
        }
        Ok(())
    }

    pub fn seek(&self, seconds: f64) -> bool {
        self.playbin
            .seek_simple(
                gst::SeekFlags::FLUSH | gst::SeekFlags::KEY_UNIT,
                gst::ClockTime::from_nseconds((seconds.max(0.0) * 1_000_000_000.0) as u64),
            )
            .is_ok()
    }

    pub fn position(&self) -> Option<f64> {
        self.playbin
            .query_position::<gst::ClockTime>()
            .map(|value| value.nseconds() as f64 / 1_000_000_000.0)
    }

    pub fn duration(&self) -> Option<f64> {
        self.playbin
            .query_duration::<gst::ClockTime>()
            .map(|value| value.nseconds() as f64 / 1_000_000_000.0)
    }

    pub fn set_volume(&self, volume: f64) {
        self.playbin.set_property("volume", volume.clamp(0.0, 1.0));
    }

    pub fn set_muted(&self, muted: bool) {
        self.playbin.set_property("mute", muted);
    }

    pub fn set_subtitle_uri(&self, uri: Option<&str>) {
        self.playbin.set_property("suburi", uri);
    }

    pub fn paintable(&self) -> Option<gtk::gdk::Paintable> {
        self.video_sink
            .property::<Option<gtk::gdk::Paintable>>("paintable")
    }

    pub fn poll_event(&self) -> Option<EngineEvent> {
        let bus = self.playbin.bus()?;
        let message = bus.timed_pop_filtered(
            gst::ClockTime::ZERO,
            &[gst::MessageType::Eos, gst::MessageType::Error],
        )?;
        match message.view() {
            gst::MessageView::Eos(_) => Some(EngineEvent::Ended),
            gst::MessageView::Error(error) => Some(EngineEvent::Failed(error.error().to_string())),
            _ => None,
        }
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
}
