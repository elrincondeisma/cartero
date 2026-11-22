//! Autenticaciones que firman la petición: Digest, OAuth 1.0, AWS Signature v4 y Hawk.

use base64::Engine as _;
use cartero_model::Auth;
use cartero_model::prepare::{Prepared, PreparedBody};
use hmac::{Hmac, Mac};
use sha2::Digest as _;
use url::Url;

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

/// Como encodeURIComponent estricto (RFC 3986): todo menos A-Z a-z 0-9 - _ . ~
const RFC3986: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC.remove(b'-').remove(b'_').remove(b'.').remove(b'~');

fn enc(s: &str) -> String {
    percent_encoding::utf8_percent_encode(s, RFC3986).to_string()
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut m = Hmac::<sha2::Sha256>::new_from_slice(key).expect("hmac");
    m.update(data);
    m.finalize().into_bytes().to_vec()
}

fn hmac_sha1(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut m = Hmac::<sha1::Sha1>::new_from_slice(key).expect("hmac");
    m.update(data);
    m.finalize().into_bytes().to_vec()
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn nonce(len: usize) -> String {
    use rand::Rng;
    let chars = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::rng();
    (0..len).map(|_| chars[rng.random_range(0..chars.len())] as char).collect()
}

fn truthy(a: &Auth, key: &str, default: bool) -> bool {
    match a.get(key).as_deref() {
        Some("true") => true,
        Some("false") => false,
        _ => default,
    }
}

/// Firma la petición antes de enviarla (todas menos Digest, que necesita el reto del servidor).
pub fn sign(p: &mut Prepared, body: &[u8]) {
    let Some(auth) = p.auth.clone() else { return };
    match auth.kind.as_str() {
        "oauth1" => oauth1(p, &auth),
        "awsv4" => awsv4(p, &auth, body, chrono::Utc::now()),
        "hawk" => hawk(p, &auth, body),
        _ => {}
    }
}

// ───────────────────────────── OAuth 1.0 ─────────────────────────────

fn oauth1(p: &mut Prepared, a: &Auth) {
    let method = a.get_or("signatureMethod", "HMAC-SHA1");
    let ts = a.get("timestamp").filter(|s| !s.is_empty()).unwrap_or_else(|| chrono::Utc::now().timestamp().to_string());
    let nonce = a.get("nonce").filter(|s| !s.is_empty()).unwrap_or_else(|| nonce(11));
    let mut oauth: Vec<(String, String)> = vec![
        ("oauth_consumer_key".into(), a.get_or("consumerKey", "")),
        ("oauth_signature_method".into(), method.clone()),
        ("oauth_timestamp".into(), ts),
        ("oauth_nonce".into(), nonce),
        ("oauth_version".into(), a.get_or("version", "1.0")),
    ];
    let token = a.get_or("token", "");
    if !token.is_empty() {
        oauth.push(("oauth_token".into(), token));
    }
    for (k, ok) in [("callback", "oauth_callback"), ("verifier", "oauth_verifier")] {
        if let Some(v) = a.get(k).filter(|v| !v.is_empty()) {
            oauth.push((ok.into(), v));
        }
    }
    let Ok(url) = Url::parse(&p.url) else { return };
    let mut params: Vec<(String, String)> = url.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
    if let PreparedBody::UrlEncoded(list) = &p.body {
        params.extend(list.iter().cloned());
    }
    params.extend(oauth.iter().cloned());
    let mut encoded: Vec<(String, String)> = params.iter().map(|(k, v)| (enc(k), enc(v))).collect();
    encoded.sort();
    let param_str = encoded.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("&");
    let mut base_url = format!("{}://{}", url.scheme(), url.host_str().unwrap_or_default().to_lowercase());
    if let Some(port) = url.port() {
        base_url.push_str(&format!(":{port}"));
    }
    base_url.push_str(url.path());
    let base = format!("{}&{}&{}", p.method.to_uppercase(), enc(&base_url), enc(&param_str));
    let key = format!("{}&{}", enc(&a.get_or("consumerSecret", "")), enc(&a.get_or("tokenSecret", "")));
    let signature = match method.as_str() {
        "HMAC-SHA256" => B64.encode(hmac_sha256(key.as_bytes(), base.as_bytes())),
        "PLAINTEXT" => key,
        _ => B64.encode(hmac_sha1(key.as_bytes(), base.as_bytes())),
    };
    oauth.push(("oauth_signature".into(), signature));
    if truthy(a, "addParamsToHeader", true) {
        let mut parts = vec![];
        if let Some(realm) = a.get("realm").filter(|r| !r.is_empty()) {
            parts.push(format!("realm=\"{}\"", realm.replace('"', "")));
        }
        parts.extend(oauth.iter().map(|(k, v)| format!("{k}=\"{}\"", enc(v))));
        p.set_header("Authorization", format!("OAuth {}", parts.join(",")));
    } else {
        for (k, v) in &oauth {
            p.add_query(k, v);
        }
    }
}

// ─────────────────────────── AWS Signature v4 ───────────────────────────

pub(crate) fn awsv4(p: &mut Prepared, a: &Auth, body: &[u8], now: chrono::DateTime<chrono::Utc>) {
    let Ok(url) = Url::parse(&p.url) else { return };
    let region = a.get_or("region", "us-east-1");
    let service = a.get_or("service", "execute-api");
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let date = &amz_date[..8];
    let mut host = url.host_str().unwrap_or_default().to_string();
    if let Some(port) = url.port() {
        host.push_str(&format!(":{port}"));
    }
    let payload_hash = hex(&sha2::Sha256::digest(body));
    p.set_header("X-Amz-Date", amz_date.clone());
    if service == "s3" {
        p.set_header("X-Amz-Content-Sha256", payload_hash.clone());
    }
    if let Some(t) = a.get("sessionToken").filter(|t| !t.is_empty()) {
        p.set_header("X-Amz-Security-Token", t);
    }
    // cabeceras canónicas: host + todas las que vamos a enviar, en minúsculas y ordenadas
    let mut headers: Vec<(String, String)> = vec![("host".into(), host)];
    for (k, v) in &p.headers {
        let k = k.to_lowercase();
        if k == "host" || k == "authorization" || k == "user-agent" || k == "content-length" {
            continue;
        }
        headers.push((k, v.split_whitespace().collect::<Vec<_>>().join(" ")));
    }
    headers.sort_by(|x, y| x.0.cmp(&y.0));
    let canonical_headers: String = headers.iter().map(|(k, v)| format!("{k}:{v}\n")).collect();
    let signed: String = headers.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>().join(";");
    let path = if url.path().is_empty() { "/".to_string() } else { url.path().to_string() };
    let canonical_uri = if service == "s3" {
        path
    } else {
        path.split('/')
            .map(|seg| {
                let decoded = percent_encoding::percent_decode_str(seg).decode_utf8_lossy().into_owned();
                enc(&enc(&decoded))
            })
            .collect::<Vec<_>>()
            .join("/")
    };
    let mut query: Vec<(String, String)> = url.query_pairs().map(|(k, v)| (enc(&k), enc(&v))).collect();
    query.sort();
    let canonical_query = query.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("&");
    let canonical =
        format!("{}\n{canonical_uri}\n{canonical_query}\n{canonical_headers}\n{signed}\n{payload_hash}", p.method.to_uppercase());
    let scope = format!("{date}/{region}/{service}/aws4_request");
    let to_sign = format!("AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}", hex(&sha2::Sha256::digest(canonical.as_bytes())));
    let k_date = hmac_sha256(format!("AWS4{}", a.get_or("secretKey", "")).as_bytes(), date.as_bytes());
    let k_region = hmac_sha256(&k_date, region.as_bytes());
    let k_service = hmac_sha256(&k_region, service.as_bytes());
    let k_signing = hmac_sha256(&k_service, b"aws4_request");
    let signature = hex(&hmac_sha256(&k_signing, to_sign.as_bytes()));
    p.set_header(
        "Authorization",
        format!("AWS4-HMAC-SHA256 Credential={}/{scope}, SignedHeaders={signed}, Signature={signature}", a.get_or("accessKey", "")),
    );
}

// ───────────────────────────────── Hawk ─────────────────────────────────

fn hawk(p: &mut Prepared, a: &Auth, body: &[u8]) {
    let Ok(url) = Url::parse(&p.url) else { return };
    let sha1 = a.get_or("algorithm", "sha256").eq_ignore_ascii_case("sha1");
    let ts = a.get("timestamp").filter(|s| !s.is_empty()).unwrap_or_else(|| chrono::Utc::now().timestamp().to_string());
    let nonce = a.get("nonce").filter(|s| !s.is_empty()).unwrap_or_else(|| nonce(6));
    let ext = a.get_or("extraData", "");
    let mut resource = url.path().to_string();
    if let Some(q) = url.query() {
        resource.push('?');
        resource.push_str(q);
    }
    let host = url.host_str().unwrap_or_default().to_lowercase();
    let port = url.port_or_known_default().unwrap_or(80);
    let hash = if truthy(a, "includePayloadHash", false) {
        let ct = p.header("content-type").unwrap_or_default().split(';').next().unwrap_or_default().trim().to_lowercase();
        let mut payload = format!("hawk.1.payload\n{ct}\n").into_bytes();
        payload.extend_from_slice(body);
        payload.push(b'\n');
        let digest = if sha1 { sha1::Sha1::digest(&payload).to_vec() } else { sha2::Sha256::digest(&payload).to_vec() };
        B64.encode(digest)
    } else {
        String::new()
    };
    let app = a.get_or("app", "");
    let dlg = a.get_or("delegation", "");
    let mut normalized = format!(
        "hawk.1.header\n{ts}\n{nonce}\n{}\n{resource}\n{host}\n{port}\n{hash}\n{}\n",
        p.method.to_uppercase(),
        ext.replace('\\', "\\\\").replace('\n', "\\n")
    );
    if !app.is_empty() {
        normalized.push_str(&format!("{app}\n{dlg}\n"));
    }
    let key = a.get_or("authKey", "");
    let mac = if sha1 { hmac_sha1(key.as_bytes(), normalized.as_bytes()) } else { hmac_sha256(key.as_bytes(), normalized.as_bytes()) };
    let mut header = format!("Hawk id=\"{}\", ts=\"{ts}\", nonce=\"{nonce}\"", a.get_or("authId", ""));
    if !hash.is_empty() {
        header.push_str(&format!(", hash=\"{hash}\""));
    }
    if !ext.is_empty() {
        header.push_str(&format!(", ext=\"{}\"", ext.replace('"', "\\\"")));
    }
    header.push_str(&format!(", mac=\"{}\"", B64.encode(mac)));
    if !app.is_empty() {
        header.push_str(&format!(", app=\"{app}\""));
        if !dlg.is_empty() {
            header.push_str(&format!(", dlg=\"{dlg}\""));
        }
    }
    p.set_header("Authorization", header);
}

// ──────────────────────────────── Digest ────────────────────────────────

/// Responde al reto `WWW-Authenticate: Digest …` de un 401. Devuelve la cabecera Authorization.
pub fn digest(a: &Auth, method: &str, url: &Url, challenge: &str, body: &[u8], nc: u32) -> Option<String> {
    let rest = challenge.trim().strip_prefix("Digest").or_else(|| challenge.trim().strip_prefix("digest"))?;
    let params = parse_challenge(rest);
    let get = |k: &str| params.iter().find(|(x, _)| x.eq_ignore_ascii_case(k)).map(|(_, v)| v.clone());
    let realm = get("realm").unwrap_or_default();
    let nonce_s = get("nonce")?;
    let algorithm = get("algorithm").unwrap_or_else(|| "MD5".into());
    let qop = get("qop").map(|q| {
        if q.split(',').any(|x| x.trim() == "auth") { "auth".to_string() } else { q.split(',').next().unwrap_or("").trim().to_string() }
    });
    let opaque = get("opaque");
    let user = a.get_or("username", "");
    let pass = a.get_or("password", "");
    let h = |s: &str| -> String {
        if algorithm.to_uppercase().starts_with("SHA-256") {
            hex(&sha2::Sha256::digest(s.as_bytes()))
        } else {
            hex(&md5::Md5::digest(s.as_bytes()))
        }
    };
    let cnonce = a.get("clientNonce").filter(|c| !c.is_empty()).unwrap_or_else(|| nonce(16).to_lowercase());
    let nc_s = format!("{nc:08x}");
    let mut ha1 = h(&format!("{user}:{realm}:{pass}"));
    if algorithm.to_uppercase().ends_with("-SESS") {
        ha1 = h(&format!("{ha1}:{nonce_s}:{cnonce}"));
    }
    let mut uri = url.path().to_string();
    if let Some(q) = url.query() {
        uri.push('?');
        uri.push_str(q);
    }
    let ha2 = if qop.as_deref() == Some("auth-int") {
        h(&format!("{method}:{uri}:{}", h(&String::from_utf8_lossy(body))))
    } else {
        h(&format!("{method}:{uri}"))
    };
    let response = match &qop {
        Some(q) if !q.is_empty() => h(&format!("{ha1}:{nonce_s}:{nc_s}:{cnonce}:{q}:{ha2}")),
        _ => h(&format!("{ha1}:{nonce_s}:{ha2}")),
    };
    let mut out = format!(
        "Digest username=\"{user}\", realm=\"{realm}\", nonce=\"{nonce_s}\", uri=\"{uri}\", algorithm={algorithm}, response=\"{response}\""
    );
    if let Some(q) = qop.filter(|q| !q.is_empty()) {
        out.push_str(&format!(", qop={q}, nc={nc_s}, cnonce=\"{cnonce}\""));
    }
    if let Some(o) = opaque {
        out.push_str(&format!(", opaque=\"{o}\""));
    }
    Some(out)
}

fn parse_challenge(s: &str) -> Vec<(String, String)> {
    let mut out = vec![];
    let mut rest = s.trim();
    while !rest.is_empty() {
        let Some(eq) = rest.find('=') else { break };
        let key = rest[..eq].trim().trim_start_matches(',').trim().to_string();
        rest = rest[eq + 1..].trim_start();
        let value;
        if let Some(r) = rest.strip_prefix('"') {
            let end = r.find('"').unwrap_or(r.len());
            value = r[..end].to_string();
            rest = r.get(end + 1..).unwrap_or("");
        } else {
            let end = rest.find(',').unwrap_or(rest.len());
            value = rest[..end].trim().to_string();
            rest = &rest[end..];
        }
        rest = rest.trim_start().trim_start_matches(',').trim_start();
        out.push((key, value));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn auth(kind: &str, pairs: &[(&str, &str)]) -> Auth {
        let mut a = Auth::new(kind);
        for (k, v) in pairs {
            a.set(k, *v);
        }
        a
    }

    /// Vector «get-vanilla» de la suite oficial de AWS
    #[test]
    fn aws_sigv4_vector_oficial() {
        let a = auth(
            "awsv4",
            &[
                ("accessKey", "AKIDEXAMPLE"),
                ("secretKey", "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY"),
                ("region", "us-east-1"),
                ("service", "service"),
            ],
        );
        let mut p = Prepared { method: "GET".into(), url: "https://example.amazonaws.com/".into(), ..Default::default() };
        let now = chrono::DateTime::parse_from_rfc3339("2015-08-30T12:36:00Z").unwrap().with_timezone(&chrono::Utc);
        awsv4(&mut p, &a, b"", now);
        assert_eq!(
            p.header("authorization").unwrap(),
            "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31"
        );
    }

    /// Ejemplo de la RFC 2617 (sección 3.5)
    #[test]
    fn digest_rfc2617() {
        let a = auth("digest", &[("username", "Mufasa"), ("password", "Circle Of Life"), ("clientNonce", "0a4f113b")]);
        let url = Url::parse("http://www.nowhere.org/dir/index.html").unwrap();
        let challenge = r#"Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41""#;
        let h = digest(&a, "GET", &url, challenge, b"", 1).unwrap();
        assert!(h.contains("response=\"6629fae49393a05397450978507c4ef1\""), "{h}");
        assert!(h.contains("nc=00000001") && h.contains("opaque=\"5ccc069c403ebaf9f0171e9517f40e41\""));
    }

    /// Ejemplo de la RFC 5849 (sección 1.2, petición de photos)
    #[test]
    fn oauth1_hmac_sha1() {
        let a = auth(
            "oauth1",
            &[
                ("consumerKey", "dpf43f3p2l4k3l03"),
                ("consumerSecret", "kd94hf93k423kf44"),
                ("token", "nnch734d00sl2jdk"),
                ("tokenSecret", "pfkkdhi9sl3r4s00"),
                ("timestamp", "1191242096"),
                ("nonce", "kllo9940pd9333jh"),
            ],
        );
        let mut p = Prepared {
            method: "GET".into(),
            url: "http://photos.example.net/photos?file=vacation.jpg&size=original".into(),
            auth: Some(a),
            ..Default::default()
        };
        sign(&mut p, b"");
        assert!(
            p.header("authorization").unwrap().contains("oauth_signature=\"tR3%2BTy81lMeYAr%2FFid0kMTYa%2FWM%3D\""),
            "{:?}",
            p.header("authorization")
        );
    }

    /// Ejemplo de la especificación de Hawk (cabecera sin payload)
    #[test]
    fn hawk_ejemplo_de_la_especificacion() {
        let a = auth(
            "hawk",
            &[
                ("authId", "dh37fgj492je"),
                ("authKey", "werxhqb98rpaxn39848xrunpaw3489ruxnpa98w4rxn"),
                ("algorithm", "sha256"),
                ("timestamp", "1353832234"),
                ("nonce", "j4h3g2"),
                ("extraData", "some-app-ext-data"),
            ],
        );
        let mut p = Prepared {
            method: "GET".into(),
            url: "http://example.com:8000/resource/1?b=1&a=2".into(),
            auth: Some(a),
            ..Default::default()
        };
        sign(&mut p, b"");
        let h = p.header("authorization").unwrap();
        assert!(h.contains("mac=\"6R4rV5iE+NPoym+WwjeHzjAGXUtLNIxmo1vpMofpLAE=\""), "{h}");
    }
}
