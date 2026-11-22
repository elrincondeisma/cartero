//! Pruebas contra un servidor HTTP local que cubre redirecciones, cookies, Digest, gzip,
//! multipart y proxy.

use super::*;
use cartero_model::Auth;
use cartero_model::prepare::{FormPart, PreparedBody};
use std::io::Write as _;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

struct Req {
    method: String,
    target: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Req {
    fn header(&self, n: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(n)).map(|(_, v)| v.as_str())
    }
}

async fn read_req(s: &mut TcpStream) -> Option<Req> {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 4096];
    let head_end = loop {
        let n = s.read(&mut tmp).await.ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&tmp[..n]);
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i + 4;
        }
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
    let mut lines = head.lines();
    let first: Vec<String> = lines.next()?.split(' ').map(String::from).collect();
    let headers: Vec<(String, String)> =
        lines.filter_map(|l| l.split_once(':')).map(|(k, v)| (k.trim().to_string(), v.trim().to_string())).collect();
    let len: usize = headers.iter().find(|(k, _)| k.eq_ignore_ascii_case("content-length")).and_then(|(_, v)| v.parse().ok()).unwrap_or(0);
    let mut body = buf[head_end..].to_vec();
    while body.len() < len {
        let n = s.read(&mut tmp).await.ok()?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&tmp[..n]);
    }
    Some(Req { method: first[0].clone(), target: first.get(1).cloned().unwrap_or_default(), headers, body })
}

fn respond(status: &str, headers: &[(&str, String)], body: &[u8]) -> Vec<u8> {
    let mut out = format!("HTTP/1.1 {status}\r\ncontent-length: {}\r\nconnection: close\r\n", body.len());
    for (k, v) in headers {
        out.push_str(&format!("{k}: {v}\r\n"));
    }
    out.push_str("\r\n");
    let mut out = out.into_bytes();
    out.extend_from_slice(body);
    out
}

/// Servidor de pruebas con varias rutas
async fn server() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let (mut s, _) = listener.accept().await.unwrap();
            tokio::spawn(async move {
                let Some(r) = read_req(&mut s).await else { return };
                let path = r.target.trim_start_matches(&format!("http://{addr}")).to_string();
                let echo = || {
                    serde_json::json!({
                        "method": r.method, "path": path,
                        "headers": r.headers.iter().map(|(k, v)| (k.to_lowercase(), v.clone())).collect::<std::collections::BTreeMap<_, _>>(),
                        "body": String::from_utf8_lossy(&r.body),
                    })
                    .to_string()
                };
                let res = match path.as_str() {
                    p if p.starts_with("/slow") => {
                        tokio::time::sleep(Duration::from_millis(120)).await;
                        respond("201 Created", &[("x-cartero", "si".into())], echo().as_bytes())
                    }
                    "/redirect" => respond("302 Found", &[("location", "/echo?from=redirect".into())], b""),
                    "/see-other" => respond("303 See Other", &[("location", "/echo".into())], b""),
                    "/loop" => respond("302 Found", &[("location", "/loop".into())], b""),
                    "/login" => respond("200 OK", &[("set-cookie", "sid=abc123; Path=/; HttpOnly".into())], b"ok"),
                    "/gzip" => {
                        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
                        gz.write_all("hola comprimido ".repeat(50).as_bytes()).unwrap();
                        respond("200 OK", &[("content-encoding", "gzip".into())], &gz.finish().unwrap())
                    }
                    "/digest" => match r.header("authorization") {
                        Some(a) if a.starts_with("Digest") && a.contains("username=\"u\"") => respond("200 OK", &[], echo().as_bytes()),
                        _ => respond(
                            "401 Unauthorized",
                            &[("www-authenticate", "Digest realm=\"r\", qop=\"auth\", nonce=\"n1\", opaque=\"o\"".into())],
                            b"",
                        ),
                    },
                    _ => respond("200 OK", &[("content-type", "application/json".into())], echo().as_bytes()),
                };
                let _ = s.write_all(&res).await;
            });
        }
    });
    addr
}

fn get(url: String) -> Prepared {
    Prepared { method: "GET".into(), url, ..Default::default() }
}

fn json(res: &Response) -> serde_json::Value {
    serde_json::from_slice(&res.body).unwrap()
}

#[tokio::test]
async fn envia_y_mide_por_fases() {
    let addr = server().await;
    let mut p = get(format!("http://{addr}/slow?page=1"));
    p.method = "POST".into();
    p.headers.push(("Authorization".into(), "Bearer abc".into()));
    p.body = PreparedBody::Raw("{\"name\":\"Ana\"}".into());
    let res = send(&p, &Options::default(), None).await.unwrap();
    assert_eq!((res.status, res.reason.as_str()), (201, "Created"));
    assert_eq!(res.header("x-cartero"), Some("si"));
    let body = json(&res);
    assert_eq!(body["path"], "/slow?page=1");
    assert_eq!(body["headers"]["authorization"], "Bearer abc");
    assert_eq!(body["body"], "{\"name\":\"Ana\"}");
    // El retardo del servidor cae en «primer byte», no en TCP ni en descarga
    assert!(res.timings.first_byte >= Duration::from_millis(110), "{:?}", res.timings);
    assert!(res.timings.tcp < Duration::from_millis(50), "{:?}", res.timings);
    assert_eq!(res.timings.tls, Duration::ZERO);
    assert!(res.request_headers.iter().any(|(k, _)| k == "User-Agent"));
}

#[tokio::test]
async fn redirecciones() {
    let addr = server().await;
    let res = send(&get(format!("http://{addr}/redirect")), &Options::default(), None).await.unwrap();
    assert_eq!(res.status, 200);
    assert_eq!(json(&res)["path"], "/echo?from=redirect");
    assert_eq!(res.redirects.len(), 1);
    assert!(res.url.ends_with("/echo?from=redirect"));

    let mut post = get(format!("http://{addr}/see-other"));
    post.method = "POST".into();
    post.body = PreparedBody::Raw("x".into());
    let res = send(&post, &Options::default(), None).await.unwrap();
    assert_eq!(json(&res)["method"], "GET");

    let no = Options { follow_redirects: false, ..Default::default() };
    assert_eq!(send(&get(format!("http://{addr}/redirect")), &no, None).await.unwrap().status, 302);
    let err = send(&get(format!("http://{addr}/loop")), &Options::default(), None).await.unwrap_err();
    assert!(matches!(err, HttpError::TooManyRedirects(10)));
}

#[tokio::test]
async fn cookies_entre_peticiones() {
    let addr = server().await;
    let mut jar = CookieJar::new();
    send(&get(format!("http://{addr}/login")), &Options::default(), Some(&mut jar)).await.unwrap();
    assert_eq!(jar.list()[0].name, "sid");
    let mut p = get(format!("http://{addr}/echo"));
    p.headers.push(("Cookie".into(), "mine=1".into()));
    let res = send(&p, &Options::default(), Some(&mut jar)).await.unwrap();
    assert_eq!(json(&res)["headers"]["cookie"], "mine=1; sid=abc123");
}

#[tokio::test]
async fn digest_gzip_y_multipart() {
    let addr = server().await;
    let mut auth = Auth::new("digest");
    auth.set("username", "u");
    auth.set("password", "p");
    let mut p = get(format!("http://{addr}/digest"));
    p.auth = Some(auth);
    let res = send(&p, &Options::default(), None).await.unwrap();
    assert_eq!(res.status, 200);
    assert!(json(&res)["headers"]["authorization"].as_str().unwrap().contains("nc=00000001"));

    let res = send(&get(format!("http://{addr}/gzip")), &Options::default(), None).await.unwrap();
    assert!(res.text().starts_with("hola comprimido"));
    assert!(res.body_size < res.body.len());

    let mut p = get(format!("http://{addr}/echo"));
    p.method = "POST".into();
    p.body = PreparedBody::FormData(vec![FormPart::Text { key: "a".into(), value: "1".into(), content_type: None }]);
    let res = send(&p, &Options::default(), None).await.unwrap();
    let body = json(&res);
    assert!(body["headers"]["content-type"].as_str().unwrap().starts_with("multipart/form-data; boundary="));
    assert!(body["body"].as_str().unwrap().contains("name=\"a\"\r\n\r\n1"));
}

#[tokio::test]
async fn por_proxy_http() {
    let addr = server().await;
    // el «proxy» es el mismo servidor: recibe la URL absoluta y la cabecera Proxy-Authorization
    let opts = Options { proxy: Some(Proxy { url: format!("http://user:pass@{addr}"), bypass: vec![] }), ..Default::default() };
    let res = send(&get("http://api.example.test/echo".into()), &opts, None).await.unwrap();
    let body = json(&res);
    assert_eq!(body["path"], "http://api.example.test/echo");
    assert_eq!(body["headers"]["proxy-authorization"], "Basic dXNlcjpwYXNz");
    assert!(!Proxy { url: String::new(), bypass: vec!["example.test".into()] }.applies_to("api.example.test"));
}

#[tokio::test]
async fn errores_claros() {
    let err = send(&get("http://127.0.0.1:1/".into()), &Options::default(), None).await.unwrap_err();
    assert!(matches!(err, HttpError::Connect { .. }), "{err}");
    let err = send(&get("ftp://x".into()), &Options::default(), None).await.unwrap_err();
    assert!(matches!(err, HttpError::InvalidUrl(_)));
    let addr = server().await;
    let opts = Options { timeout: Duration::from_millis(50), ..Default::default() };
    assert!(matches!(send(&get(format!("http://{addr}/slow")), &opts, None).await.unwrap_err(), HttpError::Timeout(_)));
}

/// Necesita Internet: `cargo test -p cartero-http -- --ignored`
#[tokio::test]
#[ignore]
async fn https_real_con_http2() {
    let res = send(&get("https://www.google.com/generate_204".into()), &Options::default(), None).await.unwrap();
    assert_eq!(res.status, 204);
    assert_eq!(res.http_version, "2.0");
    assert!(res.tls.is_some());
    eprintln!("{} {} · {:?} · {:?}", res.status, res.http_version, res.timings, res.tls);
}
