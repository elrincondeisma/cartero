//! Conectar un servidor con el navegador: la app escucha en 127.0.0.1 y la página
//! /connect-desktop del servidor (con tu sesión abierta) le entrega un token.

use std::collections::HashMap;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// Devuelve el token, o un error legible.
pub async fn via_browser(server: String, open_browser: impl Fn(&str) + Send) -> Result<String, String> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let state: String = uuid::Uuid::new_v4().simple().to_string();
    let device = gethostname::gethostname().to_string_lossy().to_string();
    let mut url =
        url::Url::parse(&format!("{}/connect-desktop", server.trim_end_matches('/'))).map_err(|e| format!("URL no válida: {e}"))?;
    url.query_pairs_mut().append_pair("port", &port.to_string()).append_pair("state", &state).append_pair("device", &device);
    open_browser(url.as_str());
    tokio::time::timeout(Duration::from_secs(600), async {
        loop {
            let (mut s, _) = listener.accept().await.map_err(|e| e.to_string())?;
            let mut buf = vec![0u8; 8192];
            let n = s.read(&mut buf).await.map_err(|e| e.to_string())?;
            let req = String::from_utf8_lossy(&buf[..n]).to_string();
            let target = req.split_whitespace().nth(1).unwrap_or("/").to_string();
            let Ok(u) = url::Url::parse(&format!("http://127.0.0.1{target}")) else { continue };
            if u.path() != "/callback" {
                let _ = s.write_all(b"HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\n\r\n").await;
                continue;
            }
            let q: HashMap<String, String> = u.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
            let ok = q.get("state") == Some(&state) && q.get("token").is_some_and(|t| t.starts_with("crt_"));
            let html = if ok {
                "<html><body style='font-family:sans-serif;text-align:center;padding:60px'><h2>Cartero conectado</h2><p>Ya puedes volver a la app.</p><p style='color:#888'>Cartero is connected. You can go back to the app.</p></body></html>"
            } else {
                "<html><body style='font-family:sans-serif;text-align:center;padding:60px'><h2>No se pudo conectar</h2><p>Vuelve a la app e inténtalo de nuevo.</p></body></html>"
            };
            let _ = s.write_all(format!("HTTP/1.1 200 OK\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{html}", html.len()).as_bytes()).await;
            if ok {
                return Ok(q["token"].clone());
            }
            return Err("La respuesta no corresponde a esta conexión".to_string());
        }
    })
    .await
    .map_err(|_| "Se agotó el tiempo de espera (10 minutos)".to_string())?
}
