//! Comandos cURL pegados (bash, cmd.exe o PowerShell) → una petición.

use super::ImportError;
use crate::types::{Auth, Body, Collection, FormParam, Item, KeyValue, Request, Url};

pub fn is_curl(text: &str) -> bool {
    let t = text.trim_start().to_ascii_lowercase();
    t.starts_with("curl ") || t.starts_with("curl.exe ") || t.starts_with("curl\t") || t.starts_with("curl\\")
}

fn tokenize(cmd: &str) -> Result<Vec<String>, ImportError> {
    let cleaned =
        cmd.replace("\\\r\n", " ").replace("\\\n", " ").replace("^\r\n", " ").replace("^\n", " ").replace("`\r\n", " ").replace("`\n", " ");
    shell_words::split(cleaned.trim()).map_err(|e| ImportError::Invalid(format!("No se puede leer el comando cURL: {e}")))
}

const NO_VALUE: &[&str] = &[
    "-G",
    "--get",
    "-I",
    "--head",
    "-k",
    "--insecure",
    "-L",
    "--location",
    "-s",
    "--silent",
    "-S",
    "--show-error",
    "-v",
    "--verbose",
    "-i",
    "--include",
    "--compressed",
    "-f",
    "--fail",
    "-#",
    "--progress-bar",
    "--http1.1",
    "--http2",
    "--globoff",
    "-g",
    "-N",
    "--no-buffer",
];
const WITH_VALUE: &[&str] = &[
    "--max-time",
    "--connect-timeout",
    "--retry",
    "--output",
    "--proxy",
    "--cert",
    "--key",
    "--cacert",
    "--resolve",
    "--interface",
    "--limit-rate",
    "--write-out",
    "--config",
    "-o",
    "-m",
    "-x",
    "-w",
    "-E",
    "-K",
];

fn looks_json(s: &str) -> bool {
    let t = s.trim();
    (t.starts_with('{') || t.starts_with('[')) && serde_json::from_str::<serde_json::Value>(t).is_ok()
}

fn decode(s: &str) -> String {
    percent_encoding::percent_decode_str(&s.replace('+', " ")).decode_utf8().map(|c| c.into_owned()).unwrap_or_else(|_| s.to_string())
}

fn pairs(raw: &str, decode_values: bool) -> Vec<KeyValue> {
    raw.split('&')
        .map(|p| match p.split_once('=') {
            Some((k, v)) => KeyValue::new(k, if decode_values { decode(v) } else { v.to_string() }),
            None => KeyValue::new(p, ""),
        })
        .collect()
}

/// Convierte un comando cURL en una colección con una sola petición.
pub fn import(text: &str) -> Result<Collection, ImportError> {
    let request = parse(text)?;
    let name = match url::Url::parse(&request.url.raw()) {
        Ok(u) => format!("{} {}", request.method, u.path()),
        Err(_) => request.url.raw(),
    };
    let mut c = Collection::new("Importado desde cURL");
    c.item.push(Item::request(&name, request));
    Ok(c)
}

/// Solo la petición, para pegar un cURL en la barra de la URL.
pub fn parse(text: &str) -> Result<Request, ImportError> {
    let tokens = tokenize(text)?;
    if !tokens.first().is_some_and(|t| t.eq_ignore_ascii_case("curl") || t.eq_ignore_ascii_case("curl.exe")) {
        return Err(ImportError::Invalid("No es un comando cURL".into()));
    }
    let (mut method, mut url) = (None::<String>, String::new());
    let mut headers: Vec<KeyValue> = vec![];
    let (mut data, mut urlencoded) = (vec![], vec![]);
    let mut form: Vec<FormParam> = vec![];
    let (mut user, mut get, mut head, mut json) = (None::<String>, false, false, false);

    let mut i = 1;
    while i < tokens.len() {
        let mut tok = tokens[i].clone();
        let mut val: Option<String> = None;
        if tok.starts_with("--")
            && let Some(eq) = tok.find('=')
        {
            val = Some(tok[eq + 1..].to_string());
            tok.truncate(eq);
        }
        // flags cortas pegadas: -XPOST, -HAccept:x
        if val.is_none() && tok.len() > 2 && tok.starts_with('-') && !tok.starts_with("--") && "XHdFuAbe".contains(&tok[1..2]) {
            val = Some(tok[2..].to_string());
            tok.truncate(2);
        }
        let mut next = || {
            if let Some(v) = val.take() {
                return v;
            }
            i += 1;
            tokens.get(i).cloned().unwrap_or_default()
        };
        match tok.as_str() {
            "-X" | "--request" => method = Some(next().to_uppercase()),
            "-H" | "--header" => {
                let h = next();
                if let Some((k, v)) = h.split_once(':') {
                    headers.push(KeyValue::new(k.trim(), v.trim()));
                }
            }
            "-d" | "--data" | "--data-raw" | "--data-binary" | "--data-ascii" => data.push(next()),
            "--json" => {
                data.push(next());
                json = true;
            }
            "--data-urlencode" => urlencoded.push(next()),
            "-F" | "--form" | "--form-string" => {
                let f = next();
                let (key, mut value) = f.split_once('=').map(|(k, v)| (k.to_string(), v.to_string())).unwrap_or((f.clone(), String::new()));
                let is_file = tok != "--form-string" && value.starts_with('@');
                if is_file {
                    value = value[1..].split(';').next().unwrap_or_default().to_string();
                    form.push(FormParam { key, kind: Some("file".into()), src: Some(value.into()), ..Default::default() });
                } else {
                    form.push(FormParam { key, value: Some(value), kind: Some("text".into()), ..Default::default() });
                }
            }
            "-u" | "--user" => user = Some(next()),
            "-A" | "--user-agent" => headers.push(KeyValue::new("User-Agent", next())),
            "-e" | "--referer" => headers.push(KeyValue::new("Referer", next())),
            "-b" | "--cookie" => headers.push(KeyValue::new("Cookie", next())),
            "--url" => url = next(),
            "-G" | "--get" => get = true,
            "-I" | "--head" => head = true,
            t if t.starts_with('-') => {
                if val.is_none() && !NO_VALUE.contains(&t) && (WITH_VALUE.contains(&t) || (t.len() == 2 && !t.starts_with("--"))) {
                    i += 1;
                }
            }
            _ if url.is_empty() => url = tok,
            _ => {}
        }
        i += 1;
    }

    if url.is_empty() {
        return Err(ImportError::Invalid("El comando cURL no tiene URL".into()));
    }
    if !url.contains("://") && !url.starts_with("{{") {
        url = format!("http://{url}");
    }
    let has = |hs: &[KeyValue], k: &str| hs.iter().any(|h| h.key.eq_ignore_ascii_case(k));
    if json {
        if !has(&headers, "content-type") {
            headers.push(KeyValue::new("Content-Type", "application/json"));
        }
        if !has(&headers, "accept") {
            headers.push(KeyValue::new("Accept", "application/json"));
        }
    }

    let mut body = None;
    if get && (!data.is_empty() || !urlencoded.is_empty()) {
        let qs = [data.clone(), urlencoded.clone()].concat().join("&");
        url.push(if url.contains('?') { '&' } else { '?' });
        url.push_str(&qs);
    } else if !form.is_empty() {
        body = Some(Body { mode: Some("formdata".into()), formdata: Some(form), ..Default::default() });
    } else if !urlencoded.is_empty() && data.is_empty() {
        let list = urlencoded
            .iter()
            .map(|p| match p.split_once('=') {
                Some((k, v)) => KeyValue::new(k, decode(v)),
                None => KeyValue::new(p, ""),
            })
            .collect();
        body = Some(Body { mode: Some("urlencoded".into()), urlencoded: Some(list), ..Default::default() });
    } else if !data.is_empty() || !urlencoded.is_empty() {
        let raw = [data, urlencoded].concat().join("&");
        let ct = headers.iter().find(|h| h.key.eq_ignore_ascii_case("content-type")).map(|h| h.value.to_lowercase()).unwrap_or_default();
        let form_like = {
            let first = raw.split('=').next().unwrap_or_default();
            raw.contains('=') && !first.is_empty() && !first.contains(['&', ' ', '{', '[', '<', '\n'])
        };
        if (ct.is_empty() || ct.contains("x-www-form-urlencoded")) && form_like && !ct.contains("json") {
            body = Some(Body { mode: Some("urlencoded".into()), urlencoded: Some(pairs(&raw, true)), ..Default::default() });
        } else {
            let lang = if ct.contains("json") || (ct.is_empty() && looks_json(&raw)) {
                "json"
            } else if ct.contains("xml") {
                "xml"
            } else if ct.contains("html") {
                "html"
            } else {
                "text"
            };
            let mut b = Body { mode: Some("raw".into()), raw: Some(raw), ..Default::default() };
            b.set_raw_language(lang);
            body = Some(b);
        }
    }

    let method = method.unwrap_or_else(|| {
        (if head {
            "HEAD"
        } else if body.is_some() {
            "POST"
        } else {
            "GET"
        })
        .to_string()
    });
    let mut request = Request { method, url: Url::Parts(crate::url::parse(&url)), header: Some(headers), body, ..Default::default() };
    if let Some(u) = user {
        let (name, pass) = u.split_once(':').unwrap_or((&u, ""));
        let mut a = Auth::new("basic");
        a.set("username", name);
        a.set("password", pass);
        request.auth = Some(Some(a));
    }
    Ok(request)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(cmd: &str) -> Request {
        parse(cmd).unwrap()
    }

    #[test]
    fn post_json_multilinea() {
        let r = req(
            "curl -X POST 'https://api.example.com/v1/items?x=1' \\\n  -H 'Content-Type: application/json' \\\n  -H \"Authorization: Bearer abc\" \\\n  --data-raw '{\"name\":\"a b\"}' --compressed",
        );
        assert_eq!(r.method, "POST");
        assert_eq!(r.url.raw(), "https://api.example.com/v1/items?x=1");
        assert_eq!(r.headers(), &[KeyValue::new("Content-Type", "application/json"), KeyValue::new("Authorization", "Bearer abc")]);
        let b = r.body.unwrap();
        assert_eq!((b.mode(), b.raw.as_deref(), b.raw_language()), ("raw", Some("{\"name\":\"a b\"}"), "json"));
    }

    #[test]
    fn form_data_basic_y_post_implicito() {
        let r = req("curl https://x.io/up -u user:pass -F file=@/tmp/a.png -F 'title=hola mundo'");
        assert_eq!(r.method, "POST");
        let a = r.auth().unwrap();
        assert_eq!((a.kind.as_str(), a.get("password").as_deref()), ("basic", Some("pass")));
        let f = r.body.unwrap().formdata.unwrap();
        assert!(f[0].is_file() && f[0].files() == vec!["/tmp/a.png"]);
        assert_eq!(f[1].value.as_deref(), Some("hola mundo"));
    }

    #[test]
    fn urlencoded_y_get() {
        let r = req("curl https://x.io/t -d grant_type=client_credentials -d scope=read%20write");
        let u = r.body.unwrap().urlencoded.unwrap();
        assert_eq!(u, vec![KeyValue::new("grant_type", "client_credentials"), KeyValue::new("scope", "read write")]);
        let r = req("curl -G https://x.io/s -d q=hola");
        assert_eq!((r.method.as_str(), r.url.raw().as_str()), ("GET", "https://x.io/s?q=hola"));
    }

    #[test]
    fn json_y_url_sin_protocolo() {
        let r = req("curl --json '{\"a\":1}' localhost:8080/api");
        assert_eq!(r.url.raw(), "http://localhost:8080/api");
        let keys: Vec<_> = r.headers().iter().map(|h| h.key.as_str()).collect();
        assert_eq!(keys, vec!["Content-Type", "Accept"]);
        let r = req("curl -XPUT -HAccept:x https://x.io -k --max-time 5");
        assert_eq!((r.method.as_str(), r.headers()[0].value.as_str()), ("PUT", "x"));
    }
}
