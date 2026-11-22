//! De una petición del modelo (con {{variables}}) a lo que se envía de verdad.

use base64::Engine as _;

use crate::types::{Auth, Request, Url};
use crate::vars::Layers;

#[derive(Debug, Clone, PartialEq)]
pub enum FormPart {
    Text { key: String, value: String, content_type: Option<String> },
    File { key: String, path: String, content_type: Option<String> },
}

#[derive(Debug, Clone, Default, PartialEq)]
pub enum PreparedBody {
    #[default]
    None,
    Raw(String),
    UrlEncoded(Vec<(String, String)>),
    FormData(Vec<FormPart>),
    File(String),
}

/// Petición lista para enviar: variables resueltas, parámetros de ruta sustituidos y la
/// autenticación sencilla (basic, bearer, API key, OAuth 2.0 con token) ya aplicada.
/// Las que necesitan firmar (Digest, OAuth 1.0, AWS, Hawk) quedan en `auth` para el motor HTTP.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Prepared {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: PreparedBody,
    pub auth: Option<Auth>,
}

impl Prepared {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
    pub fn set_header(&mut self, name: &str, value: impl Into<String>) {
        let value = value.into();
        match self.headers.iter_mut().find(|(k, _)| k.eq_ignore_ascii_case(name)) {
            Some(h) => h.1 = value,
            None => self.headers.push((name.to_string(), value)),
        }
    }
    pub fn add_query(&mut self, key: &str, value: &str) {
        let enc = |s: &str| percent_encoding::utf8_percent_encode(s, QUERY).to_string();
        let (base, hash) = match self.url.split_once('#') {
            Some((b, h)) => (b.to_string(), Some(h.to_string())),
            None => (self.url.clone(), None),
        };
        let sep = if base.contains('?') { '&' } else { '?' };
        self.url = format!("{base}{sep}{}={}", enc(key), enc(value));
        if let Some(h) = hash {
            self.url.push('#');
            self.url.push_str(&h);
        }
    }
}

const QUERY: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC.remove(b'-').remove(b'_').remove(b'.').remove(b'~');

/// Cuerpo raw: Content-Type que pone Postman según el lenguaje si el usuario no lo ha puesto.
fn raw_content_type(lang: &str) -> Option<&'static str> {
    Some(match lang {
        "json" => "application/json",
        "xml" => "application/xml",
        "html" => "text/html",
        "javascript" => "application/javascript",
        "text" => "text/plain",
        _ => return None,
    })
}

pub fn prepare(req: &Request, layers: &Layers, auth: Option<&Auth>) -> Prepared {
    let r = |s: &str| layers.resolve(s);
    let mut url = r(&req.url.raw());
    // :parametros de ruta
    if let Url::Parts(p) = &req.url {
        for v in p.variable.iter().flatten().filter(|v| !v.disabled && !v.key.is_empty()) {
            let value = r(&v.value_str());
            url = replace_path_param(&url, &v.key, &value);
        }
    }
    if !url.contains("://") && !url.is_empty() {
        url = format!("http://{url}");
    }
    let mut p = Prepared { method: req.method.to_uppercase(), url, ..Default::default() };
    for h in req.headers().iter().filter(|h| !h.disabled && !h.key.trim().is_empty()) {
        p.headers.push((r(&h.key), r(&h.value)));
    }
    if let Some(b) = req.body.as_ref().filter(|b| !b.disabled) {
        match b.mode() {
            "raw" => {
                p.body = PreparedBody::Raw(r(b.raw.as_deref().unwrap_or_default()));
                if p.header("content-type").is_none()
                    && let Some(ct) = raw_content_type(b.raw_language())
                {
                    p.headers.push(("Content-Type".into(), ct.into()));
                }
            }
            "urlencoded" => {
                let list = b.urlencoded.iter().flatten().filter(|kv| !kv.disabled && !kv.key.is_empty());
                p.body = PreparedBody::UrlEncoded(list.map(|kv| (r(&kv.key), r(&kv.value))).collect());
                if p.header("content-type").is_none() {
                    p.headers.push(("Content-Type".into(), "application/x-www-form-urlencoded".into()));
                }
            }
            "formdata" => {
                let mut parts = vec![];
                for f in b.formdata.iter().flatten().filter(|f| !f.disabled && !f.key.is_empty()) {
                    if f.is_file() {
                        for path in f.files() {
                            parts.push(FormPart::File { key: r(&f.key), path, content_type: f.content_type.clone() });
                        }
                    } else {
                        let value = r(f.value.as_deref().unwrap_or_default());
                        parts.push(FormPart::Text { key: r(&f.key), value, content_type: f.content_type.clone() });
                    }
                }
                p.body = PreparedBody::FormData(parts);
            }
            "file" => {
                if let Some(src) = b.file_src() {
                    p.body = PreparedBody::File(src);
                }
            }
            "graphql" => {
                let g = b.graphql.clone().unwrap_or_default();
                let query = r(g["query"].as_str().unwrap_or_default());
                let vars = r(g["variables"].as_str().unwrap_or_default());
                let vars: serde_json::Value = serde_json::from_str(&vars).unwrap_or(serde_json::Value::Null);
                let mut body = serde_json::json!({ "query": query });
                if !vars.is_null() {
                    body["variables"] = vars;
                }
                p.body = PreparedBody::Raw(body.to_string());
                if p.header("content-type").is_none() {
                    p.headers.push(("Content-Type".into(), "application/json".into()));
                }
            }
            _ => {}
        }
    }
    if let Some(a) = auth.filter(|a| !a.is_none() && !a.is_inherit()) {
        let mut resolved = a.clone();
        if let Some(serde_json::Value::Array(list)) = resolved.params.get_mut(&a.kind) {
            for attr in list.iter_mut() {
                if let Some(serde_json::Value::String(s)) = attr.get_mut("value") {
                    *s = r(s);
                }
            }
        }
        apply_simple_auth(&mut p, resolved);
    }
    p
}

fn replace_path_param(url: &str, key: &str, value: &str) -> String {
    let needle = format!(":{key}");
    let (head, tail) = match url.find(['?', '#']) {
        Some(i) => url.split_at(i),
        None => (url, ""),
    };
    let replaced: Vec<String> = head.split('/').map(|seg| if seg == needle { value.to_string() } else { seg.to_string() }).collect();
    format!("{}{tail}", replaced.join("/"))
}

fn apply_simple_auth(p: &mut Prepared, auth: Auth) {
    match auth.kind.as_str() {
        "basic" => {
            let creds = format!("{}:{}", auth.get_or("username", ""), auth.get_or("password", ""));
            p.set_header("Authorization", format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(creds)));
        }
        "bearer" => {
            let token = auth.get_or("token", "");
            if !token.is_empty() {
                p.set_header("Authorization", format!("Bearer {token}"));
            }
        }
        "apikey" => {
            let (key, value) = (auth.get_or("key", ""), auth.get_or("value", ""));
            if !key.is_empty() {
                if auth.get_or("in", "header") == "query" {
                    p.add_query(&key, &value);
                } else {
                    p.set_header(&key, value);
                }
            }
        }
        "oauth2" => {
            let token = auth.get_or("accessToken", "");
            if !token.is_empty() {
                if auth.get_or("addTokenTo", "header") == "queryParams" {
                    p.add_query("access_token", &token);
                } else {
                    let prefix = auth.get("headerPrefix").unwrap_or_else(|| "Bearer".into());
                    let value = if prefix.is_empty() { token } else { format!("{prefix} {token}") };
                    p.set_header("Authorization", value);
                }
            }
        }
        _ => p.auth = Some(auth),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Body, KeyValue};
    use crate::vars::Scope;

    #[test]
    fn variables_ruta_y_auth() {
        let mut req = Request::new("post", "{{base}}/users/:id?x={{x}}");
        if let Url::Parts(p) = &mut req.url {
            p.variable.as_mut().unwrap()[0].value = Some("{{uid}}".into());
        }
        req.header = Some(vec![KeyValue::new("X-A", "{{x}}"), KeyValue { key: "Off".into(), disabled: true, ..Default::default() }]);
        let mut b = Body { mode: Some("raw".into()), raw: Some("{\"a\":\"{{x}}\"}".into()), ..Default::default() };
        b.set_raw_language("json");
        req.body = Some(b);
        let scope: Scope = [("base", "https://api.io"), ("x", "1"), ("uid", "42"), ("tok", "T")]
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        let mut auth = Auth::new("bearer");
        auth.set("token", "{{tok}}");
        let p = prepare(&req, &Layers::new(vec![scope]), Some(&auth));
        assert_eq!(p.method, "POST");
        assert_eq!(p.url, "https://api.io/users/42?x=1");
        assert_eq!(p.header("x-a"), Some("1"));
        assert!(p.header("off").is_none());
        assert_eq!(p.header("content-type"), Some("application/json"));
        assert_eq!(p.header("authorization"), Some("Bearer T"));
        assert_eq!(p.body, PreparedBody::Raw("{\"a\":\"1\"}".into()));
    }

    #[test]
    fn api_key_en_query_y_basic() {
        let req = Request::new("GET", "https://x.io/a#h");
        let mut a = Auth::new("apikey");
        a.set("key", "api key");
        a.set("value", "v/1");
        a.set("in", "query");
        let p = prepare(&req, &Layers::default(), Some(&a));
        assert_eq!(p.url, "https://x.io/a?api%20key=v%2F1#h");
        let mut b = Auth::new("basic");
        b.set("username", "u");
        b.set("password", "p");
        let p = prepare(&req, &Layers::default(), Some(&b));
        assert_eq!(p.header("authorization"), Some("Basic dTpw"));
        let mut d = Auth::new("digest");
        d.set("username", "u");
        assert_eq!(prepare(&req, &Layers::default(), Some(&d)).auth.unwrap().kind, "digest");
    }
}
