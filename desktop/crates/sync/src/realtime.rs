//! WebSocket del servidor: avisa cuando otra persona cambia algo y de quién está conectado.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::sync::mpsc::UnboundedSender;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct Presence {
    pub id: String,
    pub name: String,
    #[serde(default, rename = "itemId")]
    pub item_id: Option<String>,
    pub color: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    Connected,
    /// Alguien (no nosotros) ha cambiado colecciones, ítems o entornos
    Changed,
    Presence(Vec<Presence>),
    Disconnected(String),
}

/// Mantiene la conexión (y la recupera) hasta que se pida parar o se cierre el canal.
pub async fn listen(base: String, token: String, workspace: String, me: String, tx: UnboundedSender<Event>, stop: Arc<AtomicBool>) {
    let ws_url = format!("{}/api/ws?workspace={workspace}", base.replacen("https://", "wss://", 1).replacen("http://", "ws://", 1));
    let mut backoff = 1u64;
    let _ = rustls::crypto::ring::default_provider().install_default();
    while !stop.load(Ordering::Relaxed) && !tx.is_closed() {
        let Ok(mut req) = ws_url.as_str().into_client_request() else { return };
        if let Ok(v) = format!("Bearer {token}").parse() {
            req.headers_mut().insert("Authorization", v);
        }
        match tokio_tungstenite::connect_async(req).await {
            Ok((stream, _)) => {
                backoff = 1;
                let _ = tx.send(Event::Connected);
                let (mut write, mut read) = stream.split();
                let mut ping = tokio::time::interval(Duration::from_secs(25));
                loop {
                    if stop.load(Ordering::Relaxed) {
                        let _ = write.send(Message::Close(None)).await;
                        return;
                    }
                    tokio::select! {
                        msg = read.next() => match msg {
                            Some(Ok(Message::Text(text))) => {
                                let v: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
                                let by_me = v["by"].as_str() == Some(me.as_str());
                                match v["type"].as_str() {
                                    Some("collection.changed" | "collections.changed" | "environments.changed") if !by_me => {
                                        let _ = tx.send(Event::Changed);
                                    }
                                    Some("presence") => {
                                        let users: Vec<Presence> = serde_json::from_value(v["users"].clone()).unwrap_or_default();
                                        let _ = tx.send(Event::Presence(users));
                                    }
                                    _ => {}
                                }
                            }
                            Some(Ok(_)) => {}
                            Some(Err(e)) => { let _ = tx.send(Event::Disconnected(e.to_string())); break; }
                            None => { let _ = tx.send(Event::Disconnected("conexión cerrada".into())); break; }
                        },
                        _ = ping.tick() => {
                            if write.send(Message::Text(r#"{"type":"ping"}"#.into())).await.is_err() { break; }
                        }
                    }
                }
            }
            Err(e) => {
                let _ = tx.send(Event::Disconnected(e.to_string()));
            }
        }
        tokio::time::sleep(Duration::from_secs(backoff)).await;
        backoff = (backoff * 2).min(60);
    }
}
