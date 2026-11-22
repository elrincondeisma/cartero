//! Motor de peticiones HTTP de Cartero.
//!
//! Hace a mano cada fase (DNS → TCP → TLS → HTTP) para medirlas por separado, igual que la
//! pestaña «Tiempos» de la web. F0: GET/POST con cabeceras y cuerpo, HTTP/1.1 y HTTP/2 (ALPN).

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::client::conn::{http1, http2};
use hyper_util::rt::{TokioExecutor, TokioIo};
use tokio::net::TcpStream;
use url::Url;

#[derive(Debug, Clone)]
pub struct Request {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<Vec<u8>>,
    pub timeout: Duration,
}

impl Request {
    pub fn get(url: impl Into<String>) -> Self {
        Self { method: "GET".into(), url: url.into(), headers: vec![], body: None, timeout: Duration::from_secs(60) }
    }
}

/// Duración de cada fase. Las que no ocurren (TLS en http://, DNS con una IP) quedan en cero.
#[derive(Debug, Clone, Default)]
pub struct Timings {
    pub dns: Duration,
    pub tcp: Duration,
    pub tls: Duration,
    /// Desde enviar la petición hasta recibir la primera línea de la respuesta
    pub first_byte: Duration,
    pub download: Duration,
    pub total: Duration,
}

#[derive(Debug, Clone)]
pub struct Response {
    pub status: u16,
    pub reason: String,
    pub http_version: String,
    pub headers: Vec<(String, String)>,
    pub body: Bytes,
    pub remote_addr: SocketAddr,
    pub timings: Timings,
}

#[derive(Debug, thiserror::Error)]
pub enum HttpError {
    #[error("URL no válida: {0}")]
    InvalidUrl(String),
    #[error("no se encuentra el servidor {host}: {detail}")]
    Dns { host: String, detail: String },
    #[error("no se puede conectar con {addr}: {detail}")]
    Connect { addr: SocketAddr, detail: String },
    #[error("error TLS con {host}: {detail}")]
    Tls { host: String, detail: String },
    #[error("error HTTP: {0}")]
    Http(String),
    #[error("se ha superado el tiempo máximo de {0:?}")]
    Timeout(Duration),
}

pub async fn send(req: Request) -> Result<Response, HttpError> {
    let timeout = req.timeout;
    tokio::time::timeout(timeout, send_inner(req)).await.map_err(|_| HttpError::Timeout(timeout))?
}

async fn send_inner(req: Request) -> Result<Response, HttpError> {
    let start = Instant::now();
    let url = Url::parse(&req.url).map_err(|e| HttpError::InvalidUrl(e.to_string()))?;
    let https = match url.scheme() {
        "https" => true,
        "http" => false,
        other => return Err(HttpError::InvalidUrl(format!("esquema no soportado: {other}"))),
    };
    let host = url.host_str().ok_or_else(|| HttpError::InvalidUrl("falta el servidor".into()))?.trim_matches(['[', ']']).to_string();
    let port = url.port_or_known_default().unwrap_or(if https { 443 } else { 80 });
    let mut t = Timings::default();

    // 1. DNS
    let ip: IpAddr = match host.parse() {
        Ok(ip) => ip,
        Err(_) => {
            let resolver = hickory_resolver::TokioResolver::builder_tokio()
                .map_err(|e| HttpError::Dns { host: host.clone(), detail: e.to_string() })?
                .build();
            let found =
                resolver.lookup_ip(host.as_str()).await.map_err(|e| HttpError::Dns { host: host.clone(), detail: e.to_string() })?;
            // Preferimos IPv4: más predecible en redes domésticas y VPN
            let ips: Vec<IpAddr> = found.iter().collect();
            *ips.iter()
                .find(|i| i.is_ipv4())
                .or(ips.first())
                .ok_or_else(|| HttpError::Dns { host: host.clone(), detail: "sin direcciones".into() })?
        }
    };
    t.dns = start.elapsed();

    // 2. TCP
    let addr = SocketAddr::new(ip, port);
    let tcp_start = Instant::now();
    let tcp = TcpStream::connect(addr).await.map_err(|e| HttpError::Connect { addr, detail: e.to_string() })?;
    tcp.set_nodelay(true).ok();
    t.tcp = tcp_start.elapsed();

    // 3. TLS (+ ALPN para elegir HTTP/2 o HTTP/1.1) y 4. HTTP
    let path = match url.query() {
        Some(q) => format!("{}?{q}", url.path()),
        None => url.path().to_string(),
    };
    let host_header = match url.port() {
        Some(p) => format!("{host}:{p}"),
        None => host.clone(),
    };
    let mut builder = hyper::Request::builder().method(req.method.as_str());
    let body = Full::new(Bytes::from(req.body.unwrap_or_default()));

    let (status, reason, version, headers, body_bytes, first_byte, download);
    if https {
        let tls_start = Instant::now();
        let mut config = rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions()
            .map_err(|e| HttpError::Tls { host: host.clone(), detail: e.to_string() })?
            .with_root_certificates(rustls::RootCertStore { roots: webpki_roots::TLS_SERVER_ROOTS.to_vec() })
            .with_no_client_auth();
        config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
        let server_name = rustls::pki_types::ServerName::try_from(host.clone())
            .map_err(|e| HttpError::Tls { host: host.clone(), detail: e.to_string() })?;
        let stream = tokio_rustls::TlsConnector::from(Arc::new(config))
            .connect(server_name, tcp)
            .await
            .map_err(|e| HttpError::Tls { host: host.clone(), detail: e.to_string() })?;
        t.tls = tls_start.elapsed();
        let h2 = stream.get_ref().1.alpn_protocol() == Some(b"h2");
        let io = TokioIo::new(stream);
        if h2 {
            builder = builder.uri(url.as_str());
            let (mut sender, conn) = http2::handshake(TokioExecutor::new(), io).await.map_err(|e| HttpError::Http(e.to_string()))?;
            tokio::spawn(conn);
            let request = with_headers(builder, &req.headers, None).body(body).map_err(|e| HttpError::Http(e.to_string()))?;
            (status, reason, version, headers, body_bytes, first_byte, download) = exchange(sender.send_request(request)).await?;
        } else {
            builder = builder.uri(path.as_str());
            let (mut sender, conn) = http1::handshake(io).await.map_err(|e| HttpError::Http(e.to_string()))?;
            tokio::spawn(conn);
            let request = with_headers(builder, &req.headers, Some(&host_header)).body(body).map_err(|e| HttpError::Http(e.to_string()))?;
            (status, reason, version, headers, body_bytes, first_byte, download) = exchange(sender.send_request(request)).await?;
        }
    } else {
        builder = builder.uri(path.as_str());
        let (mut sender, conn) = http1::handshake(TokioIo::new(tcp)).await.map_err(|e| HttpError::Http(e.to_string()))?;
        tokio::spawn(conn);
        let request = with_headers(builder, &req.headers, Some(&host_header)).body(body).map_err(|e| HttpError::Http(e.to_string()))?;
        (status, reason, version, headers, body_bytes, first_byte, download) = exchange(sender.send_request(request)).await?;
    }
    t.first_byte = first_byte;
    t.download = download;
    t.total = start.elapsed();
    Ok(Response { status, reason, http_version: version, headers, body: body_bytes, remote_addr: addr, timings: t })
}

fn with_headers(mut b: http::request::Builder, headers: &[(String, String)], host: Option<&str>) -> http::request::Builder {
    let has = |name: &str| headers.iter().any(|(k, _)| k.eq_ignore_ascii_case(name));
    if let Some(h) = host.filter(|_| !has("host")) {
        b = b.header("host", h);
    }
    if !has("user-agent") {
        b = b.header("user-agent", concat!("Cartero/", env!("CARGO_PKG_VERSION")));
    }
    if !has("accept") {
        b = b.header("accept", "*/*");
    }
    for (k, v) in headers {
        b = b.header(k.as_str(), v.as_str());
    }
    b
}

type Exchange = (u16, String, String, Vec<(String, String)>, Bytes, Duration, Duration);

async fn exchange(
    fut: impl std::future::Future<Output = hyper::Result<hyper::Response<hyper::body::Incoming>>>,
) -> Result<Exchange, HttpError> {
    let sent = Instant::now();
    let res = fut.await.map_err(|e| HttpError::Http(e.to_string()))?;
    let first_byte = sent.elapsed();
    let status = res.status();
    let version = format!("{:?}", res.version()).replace("HTTP/", "");
    let headers = res.headers().iter().map(|(k, v)| (k.to_string(), String::from_utf8_lossy(v.as_bytes()).into_owned())).collect();
    let dl = Instant::now();
    let body = res.into_body().collect().await.map_err(|e| HttpError::Http(e.to_string()))?.to_bytes();
    Ok((status.as_u16(), status.canonical_reason().unwrap_or("").to_string(), version, headers, body, first_byte, dl.elapsed()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// Servidor de pruebas: devuelve la petición recibida como JSON, tras un retardo opcional.
    async fn echo_server(delay: Duration) -> SocketAddr {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let (mut s, _) = listener.accept().await.unwrap();
                tokio::spawn(async move {
                    let mut buf = vec![0; 8192];
                    let n = s.read(&mut buf).await.unwrap();
                    let raw = String::from_utf8_lossy(&buf[..n]).to_string();
                    tokio::time::sleep(delay).await;
                    let first = raw.lines().next().unwrap_or("").to_string();
                    let body = format!("{{\"line\":{:?},\"raw\":{:?}}}", first, raw);
                    let res = format!(
                        "HTTP/1.1 201 Created\r\ncontent-type: application/json\r\ncontent-length: {}\r\nx-cartero: si\r\n\r\n{body}",
                        body.len()
                    );
                    s.write_all(res.as_bytes()).await.unwrap();
                });
            }
        });
        addr
    }

    #[tokio::test]
    async fn envia_y_mide_por_fases() {
        let addr = echo_server(Duration::from_millis(120)).await;
        let mut req = Request::get(format!("http://{addr}/users?page=1"));
        req.method = "POST".into();
        req.headers.push(("Authorization".into(), "Bearer abc".into()));
        req.body = Some(b"{\"name\":\"Ana\"}".to_vec());
        let res = send(req).await.unwrap();
        assert_eq!(res.status, 201);
        assert_eq!(res.reason, "Created");
        assert!(res.headers.iter().any(|(k, v)| k == "x-cartero" && v == "si"));
        let body = String::from_utf8_lossy(&res.body);
        assert!(body.contains("POST /users?page=1 HTTP/1.1"), "{body}");
        assert!(body.contains("authorization: Bearer abc"), "{body}");
        assert!(body.contains("{\\\"name\\\":\\\"Ana\\\"}"), "{body}");
        // El retardo del servidor cae en «primer byte», no en TCP ni en descarga
        assert!(res.timings.first_byte >= Duration::from_millis(110), "{:?}", res.timings);
        assert!(res.timings.tcp < Duration::from_millis(50), "{:?}", res.timings);
        assert_eq!(res.timings.tls, Duration::ZERO);
        assert!(res.timings.total >= res.timings.first_byte);
    }

    #[tokio::test]
    async fn errores_claros() {
        let err = send(Request::get("http://127.0.0.1:1/")).await.unwrap_err();
        assert!(matches!(err, HttpError::Connect { .. }), "{err}");
        let err = send(Request::get("ftp://x")).await.unwrap_err();
        assert!(matches!(err, HttpError::InvalidUrl(_)));
        let addr = echo_server(Duration::from_secs(5)).await;
        let mut req = Request::get(format!("http://{addr}/"));
        req.timeout = Duration::from_millis(200);
        assert!(matches!(send(req).await.unwrap_err(), HttpError::Timeout(_)));
    }

    /// Necesita Internet: `cargo test -p cartero-http -- --ignored`
    #[tokio::test]
    #[ignore]
    async fn https_real_con_http2() {
        let res = send(Request::get("https://www.google.com/generate_204")).await.unwrap();
        assert_eq!(res.status, 204);
        assert_eq!(res.http_version, "2.0");
        assert!(res.timings.dns > Duration::ZERO && res.timings.tls > Duration::ZERO, "{:?}", res.timings);
        eprintln!("{} {} · {:?}", res.status, res.http_version, res.timings);
    }
}
