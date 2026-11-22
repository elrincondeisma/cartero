//! OAuth 2.0: obtener un token con el navegador del sistema y una redirección local (código de
//! autorización con PKCE), con credenciales de cliente o con usuario y contraseña.

use std::collections::HashMap;
use std::time::Duration;

use base64::Engine as _;
use cartero_http::Options;
use cartero_model::prepare::{Prepared, PreparedBody};
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub const DEFAULT_CALLBACK: &str = "http://localhost:7777/callback";

#[derive(Debug, Clone)]
pub struct Token {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub token_type: Option<String>,
    pub expires_in: Option<u64>,
}

fn b64url(data: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(data)
}

fn random_string(len: usize) -> String {
    use rand::Rng;
    let chars = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let mut rng = rand::rng();
    (0..len).map(|_| chars[rng.random_range(0..chars.len())] as char).collect()
}

fn sha256(data: &[u8]) -> Vec<u8> {
    use sha2::Digest as _;
    sha2::Sha256::digest(data).to_vec()
}

fn enc(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

async fn token_request(p: &HashMap<String, String>, mut form: Vec<(String, String)>, opts: &Options) -> Result<Token, String> {
    let get = |k: &str| p.get(k).cloned().unwrap_or_default();
    let url = get("accessTokenUrl");
    if url.trim().is_empty() {
        return Err("Falta la URL del token".into());
    }
    let mut headers = vec![("Accept".to_string(), "application/json".to_string())];
    let (id, secret) = (get("clientId"), get("clientSecret"));
    if get("client_authentication") == "body" {
        form.push(("client_id".into(), id));
        if !secret.is_empty() {
            form.push(("client_secret".into(), secret));
        }
    } else {
        let creds = base64::engine::general_purpose::STANDARD.encode(format!("{}:{}", enc(&id), enc(&secret)));
        headers.push(("Authorization".into(), format!("Basic {creds}")));
        form.push(("client_id".into(), id));
    }
    let scope = get("scope");
    if !scope.is_empty() && !form.iter().any(|(k, _)| k == "scope") {
        form.push(("scope".into(), scope));
    }
    let prepared = Prepared { method: "POST".into(), url, headers, body: PreparedBody::UrlEncoded(form), auth: None };
    let mut prepared = prepared;
    prepared.headers.push(("Content-Type".into(), "application/x-www-form-urlencoded".into()));
    let res = cartero_http::send(&prepared, opts, None).await.map_err(|e| e.to_string())?;
    let text = res.text();
    let json: Value = serde_json::from_str(&text).unwrap_or_else(|_| {
        // Algunos servidores (GitHub) responden en formato formulario
        Value::Object(url::form_urlencoded::parse(text.as_bytes()).map(|(k, v)| (k.into_owned(), Value::String(v.into_owned()))).collect())
    });
    if let Some(token) = json["access_token"].as_str() {
        return Ok(Token {
            access_token: token.to_string(),
            refresh_token: json["refresh_token"].as_str().map(String::from),
            token_type: json["token_type"].as_str().map(String::from),
            expires_in: json["expires_in"].as_u64().or_else(|| json["expires_in"].as_str().and_then(|s| s.parse().ok())),
        });
    }
    let detail = json["error_description"].as_str().or(json["error"].as_str()).map(String::from).unwrap_or_else(|| format!("{} {}", res.status, text.chars().take(200).collect::<String>()));
    Err(detail)
}

/// Pide un token según el tipo de concesión. `params` ya tiene las variables resueltas.
pub async fn fetch_token(params: HashMap<String, String>, opts: Options, open_browser: impl Fn(&str) + Send) -> Result<Token, String> {
    let get = |k: &str| params.get(k).cloned().unwrap_or_default();
    match get("grant_type").as_str() {
        "client_credentials" => token_request(&params, vec![("grant_type".into(), "client_credentials".into())], &opts).await,
        "password" => {
            let form = vec![("grant_type".into(), "password".into()), ("username".into(), get("username")), ("password".into(), get("password"))];
            token_request(&params, form, &opts).await
        }
        _ => {
            let callback = Some(get("redirect_uri")).filter(|s| !s.trim().is_empty()).unwrap_or_else(|| DEFAULT_CALLBACK.into());
            let cb = url::Url::parse(&callback).map_err(|e| format!("URL de redirección no válida: {e}"))?;
            let host = cb.host_str().unwrap_or("localhost");
            if host != "localhost" && host != "127.0.0.1" {
                return Err("La URL de redirección tiene que ser local (localhost o 127.0.0.1) para que Cartero reciba el código".into());
            }
            let port = cb.port().unwrap_or(80);
            let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await.map_err(|e| format!("No se puede escuchar en el puerto {port}: {e}"))?;
            let state = random_string(24);
            let verifier = random_string(64);
            let challenge = b64url(&sha256(verifier.as_bytes()));
            let pkce = get("challengeAlgorithm") != "none";
            let mut auth_url = url::Url::parse(&get("authUrl")).map_err(|e| format!("URL de autorización no válida: {e}"))?;
            {
                let mut q = auth_url.query_pairs_mut();
                q.append_pair("response_type", "code").append_pair("client_id", &get("clientId")).append_pair("redirect_uri", &callback).append_pair("state", &state);
                if !get("scope").is_empty() {
                    q.append_pair("scope", &get("scope"));
                }
                if pkce {
                    q.append_pair("code_challenge", &challenge).append_pair("code_challenge_method", "S256");
                }
            }
            open_browser(auth_url.as_str());
            let code = tokio::time::timeout(Duration::from_secs(300), async {
                loop {
                    let (mut s, _) = listener.accept().await.map_err(|e| e.to_string())?;
                    let mut buf = vec![0u8; 8192];
                    let n = s.read(&mut buf).await.map_err(|e| e.to_string())?;
                    let req = String::from_utf8_lossy(&buf[..n]).to_string();
                    let target = req.split_whitespace().nth(1).unwrap_or("/").to_string();
                    let url = url::Url::parse(&format!("http://localhost{target}")).map_err(|e| e.to_string())?;
                    let q: HashMap<String, String> = url.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
                    if !q.contains_key("code") && !q.contains_key("error") {
                        let _ = s.write_all(b"HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\n\r\n").await;
                        continue;
                    }
                    let ok = q.contains_key("code") && q.get("state") == Some(&state);
                    let html = if ok {
                        "<html><body style='font-family:sans-serif;text-align:center;padding:60px'><h2>Listo</h2><p>Ya puedes volver a Cartero.</p><p style='color:#888'>You can go back to Cartero now.</p></body></html>"
                    } else {
                        "<html><body style='font-family:sans-serif;text-align:center;padding:60px'><h2>No se pudo autorizar</h2><p>Vuelve a Cartero para ver el motivo.</p></body></html>"
                    };
                    let _ = s.write_all(format!("HTTP/1.1 200 OK\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{html}", html.len()).as_bytes()).await;
                    if let Some(err) = q.get("error") {
                        return Err(q.get("error_description").cloned().unwrap_or_else(|| err.clone()));
                    }
                    if q.get("state") != Some(&state) {
                        return Err("La respuesta no corresponde a esta petición (state distinto)".to_string());
                    }
                    return Ok(q["code"].clone());
                }
            })
            .await
            .map_err(|_| "Se ha agotado el tiempo de espera de la autorización (5 minutos)".to_string())??;
            let mut form = vec![("grant_type".into(), "authorization_code".into()), ("code".into(), code), ("redirect_uri".into(), callback)];
            if pkce {
                form.push(("code_verifier".into(), verifier));
            }
            token_request(&params, form, &opts).await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_conocido() {
        let hex: String = sha256(b"abc").iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(hex, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        // Ejemplo de PKCE de la RFC 7636
        assert_eq!(b64url(&sha256(b"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWbFEjQk")), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }
}
