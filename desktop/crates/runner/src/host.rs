//! `pm.sendRequest` y `pm.cookies.jar()` desde el sandbox: se resuelven con el motor HTTP.

use std::sync::Arc;

use cartero_http::{CookieJar, Options};
use cartero_model::prepare::{Prepared, PreparedBody};
use cartero_model::{Body, KeyValue};
use serde_json::{Value, json};
use tokio::runtime::Handle;
use tokio::sync::Mutex;

use crate::RunContext;

pub struct RunnerHost {
    handle: Handle,
    options: Options,
    jar: Arc<Mutex<CookieJar>>,
}

impl RunnerHost {
    pub fn new(ctx: &RunContext) -> Self {
        Self { handle: Handle::current(), options: ctx.options.clone(), jar: ctx.jar.clone() }
    }
}

fn prepared_from(spec: &Value) -> Prepared {
    let mut p = Prepared {
        method: spec["method"].as_str().unwrap_or("GET").to_uppercase(),
        url: spec["url"].as_str().unwrap_or_default().to_string(),
        ..Default::default()
    };
    if let Ok(h) = serde_json::from_value::<Vec<KeyValue>>(spec["header"].clone()) {
        p.headers = h.into_iter().filter(|h| !h.disabled).map(|h| (h.key, h.value)).collect();
    }
    if let Ok(b) = serde_json::from_value::<Body>(spec["body"].clone()) {
        p.body = match b.mode() {
            "raw" => PreparedBody::Raw(b.raw.clone().unwrap_or_default()),
            "urlencoded" => PreparedBody::UrlEncoded(
                b.urlencoded.iter().flatten().filter(|kv| !kv.disabled).map(|kv| (kv.key.clone(), kv.value.clone())).collect(),
            ),
            "formdata" => PreparedBody::FormData(
                b.formdata
                    .iter()
                    .flatten()
                    .filter(|f| !f.disabled)
                    .map(|f| cartero_model::prepare::FormPart::Text {
                        key: f.key.clone(),
                        value: f.value.clone().unwrap_or_default(),
                        content_type: None,
                    })
                    .collect(),
            ),
            _ => PreparedBody::None,
        };
    }
    p
}

impl cartero_script::Host for RunnerHost {
    fn send_request(&self, spec: Value) -> Result<Value, String> {
        let p = prepared_from(&spec);
        let opts = self.options.clone();
        let jar = self.jar.clone();
        let res = self.handle.block_on(async move {
            let mut jar = jar.lock().await;
            cartero_http::send(&p, &opts, Some(&mut jar)).await
        });
        let res = res.map_err(|e| e.to_string())?;
        Ok(json!({
            "code": res.status,
            "status": res.reason,
            "headers": res.headers.iter().map(|(k, v)| json!({ "key": k, "value": v })).collect::<Vec<_>>(),
            "body": res.text(),
            "responseTime": res.timings.total.as_millis() as u64,
            "responseSize": res.body_size,
        }))
    }

    fn cookie(&self, op: Value) -> Result<Value, String> {
        let url = url::Url::parse(op["url"].as_str().unwrap_or_default()).map_err(|e| format!("URL no válida: {e}"))?;
        let host = url.host_str().unwrap_or_default().to_string();
        let mut jar = self.jar.blocking_lock();
        let matches = |c: &cartero_http::CookieInfo| host == c.domain || host.ends_with(&format!(".{}", c.domain));
        match op["op"].as_str().unwrap_or_default() {
            "get" => {
                let name = op["name"].as_str().unwrap_or_default();
                Ok(jar.list().into_iter().find(|c| matches(c) && c.name == name).map(|c| Value::String(c.value)).unwrap_or(Value::Null))
            }
            "getAll" => Ok(Value::Array(
                jar.list()
                    .into_iter()
                    .filter(matches)
                    .map(|c| json!({ "name": c.name, "value": c.value, "domain": c.domain, "path": c.path }))
                    .collect(),
            )),
            "set" => {
                let cookie = match &op["cookie"] {
                    Value::String(s) => s.clone(),
                    Value::Object(o) => {
                        let mut s = format!(
                            "{}={}",
                            o.get("name").and_then(Value::as_str).unwrap_or_default(),
                            o.get("value").and_then(Value::as_str).unwrap_or_default()
                        );
                        for (k, attr) in [("path", "Path"), ("domain", "Domain"), ("expires", "Expires")] {
                            if let Some(v) = o.get(k).and_then(Value::as_str) {
                                s.push_str(&format!("; {attr}={v}"));
                            }
                        }
                        if o.get("httpOnly").and_then(Value::as_bool) == Some(true) {
                            s.push_str("; HttpOnly");
                        }
                        if o.get("secure").and_then(Value::as_bool) == Some(true) {
                            s.push_str("; Secure");
                        }
                        s
                    }
                    _ => return Err("cookie no válida".into()),
                };
                let cookie = if cookie.to_lowercase().contains("path=") { cookie } else { format!("{cookie}; Path=/") };
                if jar.set(&url, &cookie) { Ok(Value::Null) } else { Err("no se pudo guardar la cookie".into()) }
            }
            "unset" => {
                let name = op["name"].as_str().unwrap_or_default();
                for c in jar.list().into_iter().filter(|c| matches(c) && c.name == name) {
                    jar.remove(&c.domain, &c.path, &c.name);
                }
                Ok(Value::Null)
            }
            "clear" => {
                for c in jar.list().into_iter().filter(matches) {
                    jar.remove(&c.domain, &c.path, &c.name);
                }
                Ok(Value::Null)
            }
            other => Err(format!("operación de cookies desconocida: {other}")),
        }
    }
}
