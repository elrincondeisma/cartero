//! Motor de peticiones HTTP de Cartero.
//!
//! Hace a mano cada fase (DNS → TCP → TLS → HTTP) para medirlas por separado, igual que la
//! pestaña «Tiempos» de la web. Sigue redirecciones, guarda cookies, descomprime, responde a
//! Digest, firma OAuth 1.0 / AWS / Hawk y puede ir por proxy o con certificados de cliente.

pub mod auth;
pub mod body;
mod conn;
pub mod cookies;

use std::net::SocketAddr;
use std::time::{Duration, Instant};

use bytes::Bytes;
use cartero_model::prepare::Prepared;
pub use conn::Hop;
pub use cookies::{CookieInfo, CookieJar};
use url::Url;

/// Ajustes de envío (Ajustes → General de la app).
#[derive(Debug, Clone)]
pub struct Options {
    pub timeout: Duration,
    pub follow_redirects: bool,
    pub max_redirects: u32,
    pub verify_tls: bool,
    pub proxy: Option<Proxy>,
    pub client_certs: Vec<ClientCert>,
    /// Certificados de CA extra (PEM), además de los públicos
    pub ca_pem: Option<Vec<u8>>,
    /// Añade Accept-Encoding y descomprime
    pub decompress: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(60),
            follow_redirects: true,
            max_redirects: 10,
            verify_tls: true,
            proxy: None,
            client_certs: vec![],
            ca_pem: None,
            decompress: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Proxy {
    /// http://usuario:contraseña@host:puerto
    pub url: String,
    /// Dominios que no pasan por el proxy (sufijos: "example.com", "localhost")
    pub bypass: Vec<String>,
}

impl Proxy {
    pub fn applies_to(&self, host: &str) -> bool {
        let host = host.to_ascii_lowercase();
        !self
            .bypass
            .iter()
            .map(|b| b.trim().trim_start_matches("*.").trim_start_matches('.').to_ascii_lowercase())
            .any(|b| !b.is_empty() && (host == b || host.ends_with(&format!(".{b}"))))
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClientCert {
    /// Host al que se presenta ("api.example.com" o "*.example.com")
    pub host: String,
    pub cert_pem: Vec<u8>,
    pub key_pem: Vec<u8>,
}

impl ClientCert {
    pub fn matches(&self, host: &str) -> bool {
        let pattern = self.host.trim().to_ascii_lowercase();
        let host = host.to_ascii_lowercase();
        match pattern.strip_prefix("*.") {
            Some(suffix) => host.ends_with(&format!(".{suffix}")),
            None => pattern == host || pattern.split(':').next() == Some(host.as_str()),
        }
    }
}

/// Duración de cada fase. Las que no ocurren (TLS en http://, DNS con una IP) quedan en cero.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Timings {
    pub dns: Duration,
    pub tcp: Duration,
    pub tls: Duration,
    /// Desde enviar la petición hasta recibir la primera línea de la respuesta
    pub first_byte: Duration,
    pub download: Duration,
    pub total: Duration,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TlsInfo {
    pub protocol: String,
    pub cipher: String,
}

#[derive(Debug, Clone)]
pub struct Response {
    pub status: u16,
    pub reason: String,
    pub http_version: String,
    pub headers: Vec<(String, String)>,
    /// Cuerpo ya descomprimido
    pub body: Bytes,
    /// Bytes recibidos del cuerpo (antes de descomprimir)
    pub body_size: usize,
    pub headers_size: usize,
    pub remote_addr: SocketAddr,
    pub timings: Timings,
    pub tls: Option<TlsInfo>,
    /// URL final, tras las redirecciones
    pub url: String,
    /// URLs por las que ha pasado (sin la final)
    pub redirects: Vec<String>,
    /// Cabeceras que se enviaron de verdad en la última petición
    pub request_headers: Vec<(String, String)>,
}

impl Response {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
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
    #[error("error del proxy: {0}")]
    Proxy(String),
    #[error("error HTTP: {0}")]
    Http(String),
    #[error("cuerpo de la petición: {0}")]
    Body(String),
    #[error("demasiadas redirecciones (más de {0})")]
    TooManyRedirects(u32),
    #[error("se ha superado el tiempo máximo de {0:?}")]
    Timeout(Duration),
}

/// Envía una petición preparada. Si se pasa un bote, envía sus cookies y guarda las nuevas.
pub async fn send(p: &Prepared, opts: &Options, jar: Option<&mut CookieJar>) -> Result<Response, HttpError> {
    let timeout = opts.timeout;
    tokio::time::timeout(timeout, send_inner(p.clone(), opts, jar)).await.map_err(|_| HttpError::Timeout(timeout))?
}

async fn send_inner(mut p: Prepared, opts: &Options, mut jar: Option<&mut CookieJar>) -> Result<Response, HttpError> {
    let start = Instant::now();
    let (body, ct) = body::build(&p)?;
    if let Some(ct) = ct {
        p.set_header("Content-Type", ct);
    }
    if opts.decompress && p.header("accept-encoding").is_none() {
        p.headers.push(("Accept-Encoding".into(), "gzip, deflate, br, zstd".into()));
    }
    auth::sign(&mut p, &body);
    let digest = p.auth.clone().filter(|a| a.kind == "digest");

    let mut url = Url::parse(&p.url).map_err(|e| HttpError::InvalidUrl(e.to_string()))?;
    let mut method = p.method.clone();
    let mut headers = p.headers.clone();
    let mut body = Bytes::from(body);
    let mut redirects = vec![];
    let mut digest_tried = false;
    let user_cookie = p.header("cookie").map(String::from);

    loop {
        let mut sent = headers.clone();
        if let Some(j) = jar.as_deref()
            && let Some(c) = j.header_for(&url)
        {
            let merged = match &user_cookie {
                Some(u) if !u.is_empty() => format!("{u}; {c}"),
                _ => c,
            };
            sent.retain(|(k, _)| !k.eq_ignore_ascii_case("cookie"));
            sent.push(("Cookie".into(), merged));
        }
        let hop = conn::hop(&method, &url, &sent, body.clone(), opts).await?;
        if let Some(j) = jar.as_deref_mut() {
            j.store_from_headers(&url, &hop.headers);
        }
        let header = |n: &str| hop.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(n)).map(|(_, v)| v.clone());

        // Digest: el primer 401 trae el reto; se repite una vez con la respuesta calculada
        if hop.status == 401
            && !digest_tried
            && let Some(a) = &digest
            && let Some(challenge) = hop
                .headers
                .iter()
                .filter(|(k, _)| k.eq_ignore_ascii_case("www-authenticate"))
                .map(|(_, v)| v)
                .find(|v| v.trim().to_lowercase().starts_with("digest"))
            && let Some(value) = auth::digest(a, &method, &url, challenge, &body, 1)
        {
            digest_tried = true;
            headers.retain(|(k, _)| !k.eq_ignore_ascii_case("authorization"));
            headers.push(("Authorization".into(), value));
            continue;
        }

        let is_redirect = matches!(hop.status, 301 | 302 | 303 | 307 | 308);
        if opts.follow_redirects
            && is_redirect
            && let Some(location) = header("location")
        {
            if redirects.len() as u32 >= opts.max_redirects {
                return Err(HttpError::TooManyRedirects(opts.max_redirects));
            }
            let next = url.join(&location).map_err(|e| HttpError::InvalidUrl(e.to_string()))?;
            redirects.push(url.to_string());
            // 303 siempre a GET; 301/302 de POST a GET (como navegadores y Postman)
            if hop.status == 303 || (matches!(hop.status, 301 | 302) && method == "POST") {
                if method != "HEAD" {
                    method = "GET".into();
                }
                body = Bytes::new();
                headers.retain(|(k, _)| !k.eq_ignore_ascii_case("content-type") && !k.eq_ignore_ascii_case("content-length"));
            }
            // A otro dominio no se le pasan las credenciales
            if next.host_str() != url.host_str() {
                headers.retain(|(k, _)| !k.eq_ignore_ascii_case("authorization") && !k.eq_ignore_ascii_case("cookie"));
            }
            url = next;
            continue;
        }

        let encoding = header("content-encoding");
        let body_size = hop.body.len();
        let decoded = if opts.decompress { body::decode(encoding.as_deref(), &hop.body) } else { hop.body.to_vec() };
        let headers_size = hop.headers.iter().map(|(k, v)| k.len() + v.len() + 4).sum::<usize>() + 2;
        let mut timings = hop.timings;
        timings.total = start.elapsed();
        return Ok(Response {
            status: hop.status,
            reason: hop.reason,
            http_version: hop.version,
            headers: hop.headers,
            body: Bytes::from(decoded),
            body_size,
            headers_size,
            remote_addr: hop.remote_addr,
            timings,
            tls: hop.tls,
            url: url.to_string(),
            redirects,
            request_headers: hop.sent_headers,
        });
    }
}

#[cfg(test)]
mod tests;
