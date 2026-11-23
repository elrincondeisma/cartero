//! Un salto: DNS → TCP (→ CONNECT del proxy) → TLS → petición HTTP/1.1 o HTTP/2.

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::Engine as _;
use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::client::conn::{http1, http2};
use hyper_util::rt::{TokioExecutor, TokioIo};
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, ServerName};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use url::Url;

use crate::{HttpError, Options, Timings, TlsInfo};

pub struct Hop {
    pub status: u16,
    pub reason: String,
    pub version: String,
    pub headers: Vec<(String, String)>,
    pub body: Bytes,
    pub remote_addr: SocketAddr,
    pub timings: Timings,
    pub tls: Option<TlsInfo>,
    pub sent_headers: Vec<(String, String)>,
}

/// Tiempo máximo de cada fase antes de la respuesta, para que un fallo diga dónde se atascó.
const DNS_TIMEOUT: Duration = Duration::from_secs(15);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Si hay más direcciones, cada intento se corta antes para probar la siguiente.
const CONNECT_ATTEMPT: Duration = Duration::from_secs(3);
const TLS_TIMEOUT: Duration = Duration::from_secs(20);

/// Resuelve con el resolutor del sistema (getaddrinfo): respeta VPN, /etc/hosts, DNS por
/// interfaz, mDNS (.local) e iCloud Private Relay, igual que el navegador.
async fn resolve(host: &str, port: u16) -> Result<Vec<SocketAddr>, HttpError> {
    if let Ok(ip) = host.parse::<IpAddr>() {
        return Ok(vec![SocketAddr::new(ip, port)]);
    }
    let dns = |detail: String| HttpError::Dns { host: host.into(), detail };
    let found = tokio::time::timeout(DNS_TIMEOUT, tokio::net::lookup_host((host, port)))
        .await
        .map_err(|_| dns(format!("el DNS no ha respondido en {} s", DNS_TIMEOUT.as_secs())))?
        .map_err(|e| dns(e.to_string()))?;
    let addrs = order(found.collect());
    if addrs.is_empty() { Err(dns("sin direcciones".into())) } else { Ok(addrs) }
}

/// Alterna IPv6 e IPv4 respetando el orden del sistema (RFC 8305): si una familia no tiene
/// salida, la siguiente dirección es de la otra.
fn order(addrs: Vec<SocketAddr>) -> Vec<SocketAddr> {
    let mut seen = std::collections::HashSet::new();
    let addrs: Vec<SocketAddr> = addrs.into_iter().filter(|a| seen.insert(*a)).collect();
    let first_v6 = addrs.first().is_some_and(|a| a.is_ipv6());
    let (mut a, mut b): (Vec<_>, Vec<_>) = addrs.into_iter().partition(|x| x.is_ipv6() == first_v6);
    let mut out = Vec::with_capacity(a.len() + b.len());
    a.reverse();
    b.reverse();
    while !a.is_empty() || !b.is_empty() {
        out.extend(a.pop());
        out.extend(b.pop());
    }
    out
}

/// Conecta con la primera dirección que responda.
async fn connect(addrs: &[SocketAddr]) -> Result<(TcpStream, SocketAddr), HttpError> {
    let deadline = Instant::now() + CONNECT_TIMEOUT;
    let mut last = None;
    for (i, &addr) in addrs.iter().enumerate() {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break;
        }
        let wait = if i + 1 < addrs.len() { left.min(CONNECT_ATTEMPT) } else { left };
        match tokio::time::timeout(wait, TcpStream::connect(addr)).await {
            Ok(Ok(tcp)) => return Ok((tcp, addr)),
            Ok(Err(e)) => last = Some(HttpError::Connect { addr, detail: e.to_string() }),
            Err(_) => last = Some(HttpError::Connect { addr, detail: format!("sin respuesta en {} s", wait.as_secs_f32().round()) }),
        }
    }
    Err(last.unwrap_or(HttpError::Connect { addr: addrs[0], detail: "sin respuesta".into() }))
}

/// Certificados de confianza del sistema (llavero de macOS, almacén de Windows, /etc/ssl),
/// para redes con inspección TLS o CA internas. Se leen una vez.
fn system_roots() -> &'static [CertificateDer<'static>] {
    static ROOTS: std::sync::LazyLock<Vec<CertificateDer<'static>>> =
        std::sync::LazyLock::new(|| rustls_native_certs::load_native_certs().certs);
    &ROOTS
}

/// Acepta cualquier certificado (Ajustes → «Verificar certificados SSL» desactivado).
#[derive(Debug)]
struct NoVerify(Arc<rustls::crypto::CryptoProvider>);

impl rustls::client::danger::ServerCertVerifier for NoVerify {
    fn verify_server_cert(
        &self,
        _: &CertificateDer<'_>,
        _: &[CertificateDer<'_>],
        _: &ServerName<'_>,
        _: &[u8],
        _: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(message, cert, dss, &self.0.signature_verification_algorithms)
    }
    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(message, cert, dss, &self.0.signature_verification_algorithms)
    }
    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

fn tls_config(host: &str, opts: &Options) -> Result<rustls::ClientConfig, HttpError> {
    let err = |e: String| HttpError::Tls { host: host.into(), detail: e };
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let builder = rustls::ClientConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .map_err(|e| err(e.to_string()))?;
    let builder = if opts.verify_tls {
        let mut roots = rustls::RootCertStore { roots: webpki_roots::TLS_SERVER_ROOTS.to_vec() };
        roots.add_parsable_certificates(system_roots().iter().cloned());
        if let Some(pem) = &opts.ca_pem {
            for cert in CertificateDer::pem_slice_iter(pem) {
                let cert = cert.map_err(|e| err(format!("certificado de CA no válido: {e}")))?;
                roots.add(cert).map_err(|e| err(format!("certificado de CA no válido: {e}")))?;
            }
        }
        builder.with_root_certificates(roots)
    } else {
        builder.dangerous().with_custom_certificate_verifier(Arc::new(NoVerify(provider)))
    };
    let mut config = match opts.client_certs.iter().find(|c| c.matches(host)) {
        Some(c) => {
            let chain: Vec<CertificateDer<'static>> = CertificateDer::pem_slice_iter(&c.cert_pem)
                .collect::<Result<_, _>>()
                .map_err(|e| err(format!("certificado de cliente no válido: {e}")))?;
            let key =
                PrivateKeyDer::from_pem_slice(&c.key_pem).map_err(|e| err(format!("clave del certificado de cliente no válida: {e}")))?;
            builder.with_client_auth_cert(chain, key).map_err(|e| err(e.to_string()))?
        }
        None => builder.with_no_client_auth(),
    };
    config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
    Ok(config)
}

/// Abre un túnel CONNECT a través del proxy.
async fn connect_tunnel(tcp: &mut TcpStream, target: &str, auth: Option<&str>) -> Result<(), HttpError> {
    let mut req = format!("CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n");
    if let Some(a) = auth {
        req.push_str(&format!("Proxy-Authorization: {a}\r\n"));
    }
    req.push_str("\r\n");
    tcp.write_all(req.as_bytes()).await.map_err(|e| HttpError::Proxy(e.to_string()))?;
    let mut buf = Vec::with_capacity(512);
    let mut byte = [0u8; 1];
    while !buf.ends_with(b"\r\n\r\n") {
        if tcp.read(&mut byte).await.map_err(|e| HttpError::Proxy(e.to_string()))? == 0 || buf.len() > 16 * 1024 {
            return Err(HttpError::Proxy("el proxy cerró la conexión".into()));
        }
        buf.push(byte[0]);
    }
    let head = String::from_utf8_lossy(&buf);
    let status = head.split_whitespace().nth(1).unwrap_or_default();
    if status != "200" {
        return Err(HttpError::Proxy(format!("el proxy respondió {}", head.lines().next().unwrap_or_default())));
    }
    Ok(())
}

fn proxy_auth(proxy: &Url) -> Option<String> {
    if proxy.username().is_empty() {
        return None;
    }
    let user = percent_encoding::percent_decode_str(proxy.username()).decode_utf8_lossy().into_owned();
    let pass = percent_encoding::percent_decode_str(proxy.password().unwrap_or_default()).decode_utf8_lossy().into_owned();
    Some(format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(format!("{user}:{pass}"))))
}

pub async fn hop(method: &str, url: &Url, headers: &[(String, String)], body: Bytes, opts: &Options) -> Result<Hop, HttpError> {
    let start = Instant::now();
    let https = match url.scheme() {
        "https" => true,
        "http" => false,
        other => return Err(HttpError::InvalidUrl(format!("esquema no soportado: {other}"))),
    };
    let host = url.host_str().ok_or_else(|| HttpError::InvalidUrl("falta el servidor".into()))?.trim_matches(['[', ']']).to_string();
    let port = url.port_or_known_default().unwrap_or(if https { 443 } else { 80 });
    let proxy = opts
        .proxy
        .as_ref()
        .filter(|p| p.applies_to(&host))
        .map(|p| Url::parse(&p.url))
        .transpose()
        .map_err(|e| HttpError::Proxy(format!("URL del proxy no válida: {e}")))?;
    let mut t = Timings::default();

    // 1. DNS (del proxy, si hay)
    let (connect_host, connect_port) = match &proxy {
        Some(p) => (p.host_str().unwrap_or_default().trim_matches(['[', ']']).to_string(), p.port_or_known_default().unwrap_or(8080)),
        None => (host.clone(), port),
    };
    let addrs = resolve(&connect_host, connect_port).await?;
    t.dns = start.elapsed();

    // 2. TCP
    let tcp_start = Instant::now();
    let (mut tcp, addr) = connect(&addrs).await?;
    tcp.set_nodelay(true).ok();
    let proxy_auth = proxy.as_ref().and_then(proxy_auth);
    if https && proxy.is_some() {
        connect_tunnel(&mut tcp, &format!("{host}:{port}"), proxy_auth.as_deref()).await?;
    }
    t.tcp = tcp_start.elapsed();

    let path = match url.query() {
        Some(q) => format!("{}?{q}", url.path()),
        None => url.path().to_string(),
    };
    let host_header = match url.port() {
        Some(p) => format!("{host}:{p}"),
        None => host.clone(),
    };
    let mut sent = with_defaults(headers, &host_header);
    if !https && let Some(a) = &proxy_auth {
        sent.push(("Proxy-Authorization".into(), a.clone()));
    }

    let ex = if https {
        let tls_start = Instant::now();
        let config = tls_config(&host, opts)?;
        let server_name = ServerName::try_from(host.clone()).map_err(|e| HttpError::Tls { host: host.clone(), detail: e.to_string() })?;
        let stream = tokio::time::timeout(TLS_TIMEOUT, tokio_rustls::TlsConnector::from(Arc::new(config)).connect(server_name, tcp))
            .await
            .map_err(|_| HttpError::Tls {
                host: host.clone(),
                detail: format!("el servidor no ha respondido en {} s", TLS_TIMEOUT.as_secs()),
            })?
            .map_err(|e| HttpError::Tls { host: host.clone(), detail: e.to_string() })?;
        t.tls = tls_start.elapsed();
        let conn = stream.get_ref().1;
        let h2 = conn.alpn_protocol() == Some(b"h2");
        let tls = TlsInfo {
            protocol: conn.protocol_version().map(|v| format!("{v:?}").replace("TLSv1_", "TLS 1.")).unwrap_or_default(),
            cipher: conn.negotiated_cipher_suite().map(|c| format!("{:?}", c.suite())).unwrap_or_default(),
        };
        let mut ex = if h2 {
            sent.retain(|(k, _)| !k.eq_ignore_ascii_case("host") && !k.eq_ignore_ascii_case("connection"));
            exchange(stream, true, method, url.as_str(), &sent, body).await?
        } else {
            exchange(stream, false, method, &path, &sent, body).await?
        };
        ex.tls = Some(tls);
        ex
    } else {
        let target = if proxy.is_some() { url.as_str().to_string() } else { path };
        exchange(tcp, false, method, &target, &sent, body).await?
    };
    t.first_byte = ex.first_byte;
    t.download = ex.download;
    t.total = start.elapsed();
    Ok(Hop {
        status: ex.status,
        reason: ex.reason,
        version: ex.version,
        headers: ex.headers,
        body: ex.body,
        remote_addr: addr,
        timings: t,
        tls: ex.tls,
        sent_headers: sent,
    })
}

/// Cabeceras que se envían siempre salvo que el usuario ponga las suyas.
fn with_defaults(headers: &[(String, String)], host: &str) -> Vec<(String, String)> {
    let has = |name: &str| headers.iter().any(|(k, _)| k.eq_ignore_ascii_case(name));
    let mut out = vec![];
    if !has("host") {
        out.push(("Host".to_string(), host.to_string()));
    }
    if !has("user-agent") {
        out.push(("User-Agent".into(), concat!("Cartero/", env!("CARGO_PKG_VERSION")).into()));
    }
    if !has("accept") {
        out.push(("Accept".into(), "*/*".into()));
    }
    out.extend(headers.iter().cloned());
    out
}

struct Exchange {
    status: u16,
    reason: String,
    version: String,
    headers: Vec<(String, String)>,
    body: Bytes,
    first_byte: Duration,
    download: Duration,
    tls: Option<TlsInfo>,
}

async fn exchange<S>(io: S, h2: bool, method: &str, uri: &str, headers: &[(String, String)], body: Bytes) -> Result<Exchange, HttpError>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let mut builder = hyper::Request::builder().method(method).uri(uri);
    for (k, v) in headers {
        builder = builder.header(k.as_str(), v.as_str());
    }
    let request = builder.body(Full::new(body)).map_err(|e| HttpError::Http(e.to_string()))?;
    let io = TokioIo::new(io);
    let sent = Instant::now();
    let res = if h2 {
        let (mut sender, conn) = http2::handshake(TokioExecutor::new(), io).await.map_err(|e| HttpError::Http(e.to_string()))?;
        tokio::spawn(conn);
        sender.send_request(request).await
    } else {
        let (mut sender, conn) = http1::handshake(io).await.map_err(|e| HttpError::Http(e.to_string()))?;
        tokio::spawn(conn);
        sender.send_request(request).await
    }
    .map_err(|e| HttpError::Http(e.to_string()))?;
    let first_byte = sent.elapsed();
    let status = res.status();
    let version = format!("{:?}", res.version()).replace("HTTP/", "");
    let headers = res.headers().iter().map(|(k, v)| (k.to_string(), String::from_utf8_lossy(v.as_bytes()).into_owned())).collect();
    let dl = Instant::now();
    let body = res.into_body().collect().await.map_err(|e| HttpError::Http(e.to_string()))?.to_bytes();
    Ok(Exchange {
        status: status.as_u16(),
        reason: status.canonical_reason().unwrap_or("").to_string(),
        version,
        headers,
        body,
        first_byte,
        download: dl.elapsed(),
        tls: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alterna_ipv6_e_ipv4() {
        let a = |s: &str| s.parse::<SocketAddr>().unwrap();
        let got = order(vec![a("[::1]:80"), a("[::2]:80"), a("1.1.1.1:80"), a("[::1]:80"), a("2.2.2.2:80")]);
        assert_eq!(got, vec![a("[::1]:80"), a("1.1.1.1:80"), a("[::2]:80"), a("2.2.2.2:80")]);
    }

    #[tokio::test]
    async fn salta_una_ip_que_no_responde() {
        let server = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let good = server.local_addr().unwrap();
        // 10.255.255.1 no existe: el intento se corta y pasa a la siguiente dirección
        let dead: SocketAddr = "10.255.255.1:9".parse().unwrap();
        let start = Instant::now();
        let (_, addr) = connect(&[dead, good]).await.unwrap();
        assert_eq!(addr, good);
        assert!(start.elapsed() < CONNECT_ATTEMPT + Duration::from_secs(1));
    }

    #[tokio::test]
    async fn resuelve_con_el_sistema() {
        let addrs = resolve("localhost", 8080).await.unwrap();
        assert!(addrs.iter().all(|a| a.port() == 8080 && a.ip().is_loopback()));
    }
}
