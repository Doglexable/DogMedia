use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};

use super::ApiClient;
use crate::domain::SessionHolder;

#[derive(Serialize)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum SocketCommand {
    #[serde(rename = "session.bind")]
    Bind { version: u8, session_id: String },
    #[serde(rename = "playback.state")]
    State {
        version: u8,
        session_id: String,
        media_id: i64,
        action: String,
        position: f64,
        duration: f64,
        loop_mode: String,
        shuffle_enabled: bool,
        sequence: u64,
    },
}

#[derive(Deserialize)]
#[serde(tag = "type")]
enum WireEvent {
    #[serde(rename = "socket.ready")]
    Ready { version: u8 },
    #[serde(rename = "lease.state")]
    Lease {
        version: u8,
        revision: u64,
        state: String,
        #[serde(rename = "expiresIn")]
        expires_in: u64,
        #[serde(rename = "activeSession")]
        active_session: Option<SessionHolder>,
    },
    #[serde(rename = "protocol.error")]
    Error { version: u8, code: String },
}

pub enum SocketEvent {
    Ready,
    Lease {
        revision: u64,
        state: String,
        expires_in: u64,
        holder: Option<SessionHolder>,
    },
    Error(String),
    Disconnected,
}

fn parse_event(raw: &str) -> Option<SocketEvent> {
    let event: WireEvent = serde_json::from_str(raw).ok()?;
    match event {
        WireEvent::Ready { version: 1 } => Some(SocketEvent::Ready),
        WireEvent::Lease {
            version: 1,
            revision,
            state,
            expires_in,
            active_session,
        } => {
            if !matches!(state.as_str(), "available" | "owned" | "busy") {
                return None;
            }
            Some(SocketEvent::Lease {
                revision,
                state,
                expires_in,
                holder: active_session.map(SessionHolder::normalized),
            })
        }
        WireEvent::Error { version: 1, code } => Some(SocketEvent::Error(code)),
        _ => None,
    }
}

pub async fn run(
    client: ApiClient,
    mut commands: mpsc::Receiver<SocketCommand>,
    events: mpsc::Sender<SocketEvent>,
) {
    let mut attempt = 0u32;
    loop {
        let connection = async {
            let ticket = client.playback_socket_ticket().await.ok()?;
            let url = client.playback_socket_url().ok()?;
            connect_async(url.as_str())
                .await
                .ok()
                .map(|(socket, _)| (socket, ticket))
        }
        .await;
        if let Some((mut socket, ticket)) = connection {
            let auth = serde_json::json!({ "type": "auth", "version": 1, "ticket": ticket });
            if socket
                .send(Message::Text(auth.to_string().into()))
                .await
                .is_ok()
            {
                attempt = 0;
                loop {
                    tokio::select! {
                        incoming = socket.next() => {
                            match incoming {
                                Some(Ok(Message::Text(raw))) => {
                                    if let Some(event) = parse_event(&raw)
                                        && events.send(event).await.is_err() { return; }
                                }
                                Some(Ok(Message::Ping(_))) => { let _ = socket.flush().await; }
                                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                                _ => {}
                            }
                        }
                        command = commands.recv() => {
                            let Some(command) = command else { let _ = socket.close(None).await; return; };
                            let Ok(raw) = serde_json::to_string(&command) else { continue; };
                            if socket.send(Message::Text(raw.into())).await.is_err() { break; }
                        }
                    }
                }
            }
        }
        if events.send(SocketEvent::Disconnected).await.is_err() {
            return;
        }
        let base = (500u64 << attempt.min(3)).min(5000);
        attempt = attempt.saturating_add(1);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |time| time.subsec_nanos());
        let jitter = 80 + u64::from(nanos % 41);
        tokio::select! {
            () = tokio::time::sleep(Duration::from_millis(base * jitter / 100)) => {}
            command = commands.recv() => { if command.is_none() { return; } }
        }
    }
}

#[cfg(test)]
mod playback_socket_tests {
    use super::*;

    #[test]
    fn playback_socket_protocol_parses_safe_state() {
        let raw = r#"{"type":"lease.state","version":1,"revision":2,"state":"busy","expiresIn":20,"activeSession":{"platform":"web","deviceLabel":"Web","mediaId":5,"playback":{"mediaId":5,"action":"play","position":2,"duration":10}}}"#;
        let Some(SocketEvent::Lease { state, holder, .. }) = parse_event(raw) else {
            panic!("missing lease")
        };
        assert_eq!(state, "busy");
        assert_eq!(holder.unwrap().display_label(), "Web");
        assert!(
            parse_event(
                r#"{"type":"lease.state","version":2,"revision":2,"state":"busy","expiresIn":20}"#
            )
            .is_none()
        );
    }

    #[test]
    fn playback_socket_state_uses_camel_case_fields() {
        let raw = serde_json::to_value(SocketCommand::State {
            version: 1,
            session_id: "session".to_owned(),
            media_id: 5,
            action: "play".to_owned(),
            position: 2.0,
            duration: 10.0,
            loop_mode: "queue".to_owned(),
            shuffle_enabled: true,
            sequence: 3,
        })
        .unwrap();
        assert_eq!(raw["sessionId"], "session");
        assert_eq!(raw["mediaId"], 5);
        assert_eq!(raw["shuffleEnabled"], true);
        assert!(raw.get("session_id").is_none());
    }
}
