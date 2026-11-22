//! Sandbox de scripts `pm.*` de Cartero sobre QuickJS.
//!
//! Cada ejecución usa un runtime nuevo, con límite de memoria y de tiempo: un script no puede
//! bloquear la app ni ver nada fuera de lo que le pasamos. Las librerías (lodash, moment…) se
//! cargan solo si el script las pide con `require`. `pm.sendRequest` y el bote de cookies se
//! resuelven en Rust a través de [`Host`].

use std::sync::Arc;
use std::time::{Duration, Instant};

use rquickjs::{Context, Ctx, Function, Runtime};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

const PRELUDE: &str = include_str!("../assets/prelude.js");

/// Fuente de cada librería disponible con `require`, empaquetada con esbuild (ver desktop/js).
fn library(name: &str) -> Option<&'static str> {
    Some(match name {
        "chai" => include_str!("../assets/libs/chai.js"),
        "lodash" => include_str!("../assets/libs/lodash.js"),
        "crypto-js" => include_str!("../assets/libs/crypto-js.js"),
        "moment" => include_str!("../assets/libs/moment.js"),
        "uuid" => include_str!("../assets/libs/uuid.js"),
        "ajv" => include_str!("../assets/libs/ajv.js"),
        "tv4" => include_str!("../assets/libs/tv4.js"),
        "csv-parse/lib/sync" => include_str!("../assets/libs/csv-parse_lib_sync.js"),
        "xml2js" => include_str!("../assets/libs/xml2js.js"),
        "cheerio" => include_str!("../assets/libs/cheerio.js"),
        "buffer" => include_str!("../assets/libs/buffer.js"),
        _ => return None,
    })
}

/// Lo que el script puede pedir fuera del sandbox.
pub trait Host: Send + Sync {
    /// `pm.sendRequest`: recibe `{ url, method, header: [{key,value}], body }` y devuelve
    /// `{ code, status, headers: [{key,value}], body, responseTime }`.
    fn send_request(&self, request: Value) -> Result<Value, String>;
    /// `pm.cookies.jar()`: `{ op: get|getAll|set|unset|clear, url, name?, cookie? }`.
    fn cookie(&self, op: Value) -> Result<Value, String>;
}

/// Anfitrión sin red ni cookies (tests, vista previa).
pub struct NoHost;

impl Host for NoHost {
    fn send_request(&self, _: Value) -> Result<Value, String> {
        Err("pm.sendRequest no está disponible aquí".into())
    }
    fn cookie(&self, _: Value) -> Result<Value, String> {
        Err("el bote de cookies no está disponible aquí".into())
    }
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ScriptInput {
    pub script: String,
    /// "prerequest" o "test"
    pub event: String,
    #[serde(rename = "requestName")]
    pub request_name: String,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "collectionName")]
    pub collection_name: String,
    pub iteration: u32,
    #[serde(rename = "iterationCount")]
    pub iteration_count: u32,
    /// Ámbitos: environment, globals, collection (clave → texto)
    pub variables: Map<String, Value>,
    #[serde(rename = "environmentName")]
    pub environment_name: String,
    #[serde(rename = "iterationData")]
    pub iteration_data: Map<String, Value>,
    /// Variables locales (`pm.variables.set`): pasan del pre-request a los tests
    pub local: Map<String, Value>,
    /// `{ method, url, header, body, auth }` sin resolver
    pub request: Value,
    pub response: Option<ScriptResponse>,
    /// Cookies del bote que corresponden a la URL
    pub cookies: Vec<Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScriptResponse {
    pub code: u16,
    pub status: String,
    pub headers: Vec<Header>,
    pub body: String,
    #[serde(rename = "responseTime")]
    pub response_time: u64,
    #[serde(rename = "responseSize")]
    pub response_size: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Header {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Serialize)]
pub struct TestResult {
    pub name: String,
    pub passed: bool,
    #[serde(default)]
    pub skipped: bool,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct ConsoleLine {
    pub level: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum NextRequest {
    /// El script no lo ha tocado
    Unchanged,
    /// `setNextRequest(null)`: para la ejecución
    Stop,
    /// `setNextRequest("nombre")`
    Named(String),
}

#[derive(Debug, Clone, Deserialize)]
pub struct ScriptOutput {
    pub tests: Vec<TestResult>,
    pub console: Vec<ConsoleLine>,
    /// Estado final de cada ámbito de variables
    pub variables: Map<String, Value>,
    #[serde(default)]
    pub local: Map<String, Value>,
    /// Error no capturado del script (no de un test)
    pub error: Option<String>,
    /// La petición tal y como la dejó el pre-request
    #[serde(default)]
    pub request: Option<Value>,
    #[serde(default, rename = "nextRequest", deserialize_with = "next_request")]
    pub next_request: Option<Option<String>>,
    #[serde(default, rename = "skipRequest")]
    pub skip_request: bool,
    #[serde(default)]
    pub visualizer: Option<Value>,
}

fn next_request<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Option<String>>, D::Error> {
    Ok(Some(match Value::deserialize(d)? {
        Value::String(s) => Some(s),
        _ => None,
    }))
}

impl ScriptOutput {
    pub fn next(&self) -> NextRequest {
        match &self.next_request {
            None => NextRequest::Unchanged,
            Some(None) => NextRequest::Stop,
            Some(Some(n)) => NextRequest::Named(n.clone()),
        }
    }
    /// Variables de un ámbito como mapa de texto.
    pub fn scope(&self, name: &str) -> Map<String, Value> {
        self.variables.get(name).and_then(|v| v.as_object()).cloned().unwrap_or_default()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ScriptError {
    #[error("el script ha superado el tiempo máximo de {0:?}")]
    Timeout(Duration),
    #[error("error del motor de scripts: {0}")]
    Engine(String),
}

#[derive(Debug, Clone)]
pub struct Limits {
    pub timeout: Duration,
    pub memory_bytes: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self { timeout: Duration::from_secs(30), memory_bytes: 256 * 1024 * 1024 }
    }
}

fn host_reply(r: Result<Value, String>) -> String {
    match r {
        Ok(v) => serde_json::json!({ "value": v }).to_string(),
        Err(e) => serde_json::json!({ "error": e }).to_string(),
    }
}

/// Ejecuta un script pre-request o post-response y devuelve tests, consola y variables.
pub fn run(input: &ScriptInput, limits: &Limits, host: Arc<dyn Host>) -> Result<ScriptOutput, ScriptError> {
    let engine = |e: rquickjs::Error| ScriptError::Engine(e.to_string());
    let rt = Runtime::new().map_err(engine)?;
    rt.set_memory_limit(limits.memory_bytes);
    rt.set_max_stack_size(4 * 1024 * 1024);
    let deadline = Instant::now() + limits.timeout;
    rt.set_interrupt_handler(Some(Box::new(move || Instant::now() > deadline)));
    let ctx = Context::full(&rt).map_err(engine)?;
    let json_in = serde_json::to_string(input).map_err(|e| ScriptError::Engine(e.to_string()))?;

    let fail = |ctx: &Ctx, e: rquickjs::Error| {
        if Instant::now() > deadline {
            ScriptError::Timeout(limits.timeout)
        } else {
            let detail = ctx.catch().into_exception().map(|ex| ex.to_string()).unwrap_or_else(|| e.to_string());
            ScriptError::Engine(detail)
        }
    };

    ctx.with(|ctx| -> Result<(), ScriptError> {
        let globals = ctx.globals();
        globals.set("__cartero_input", json_in).map_err(engine)?;
        let host = host.clone();
        let f = Function::new(ctx.clone(), move |ctx: Ctx<'_>, op: String, arg: String| -> String {
            let arg: Value = serde_json::from_str(&arg).unwrap_or(Value::Null);
            match op.as_str() {
                "load" => {
                    let name = arg.as_str().unwrap_or_default();
                    match library(name) {
                        Some(src) => host_reply(
                            ctx.eval::<(), _>(src)
                                .map(|_| Value::Null)
                                .map_err(|e| ctx.catch().into_exception().map(|ex| ex.to_string()).unwrap_or_else(|| e.to_string())),
                        ),
                        None => host_reply(Err(format!("Cannot find module '{name}'"))),
                    }
                }
                "random" => {
                    let n = arg.as_u64().unwrap_or(0).min(65536) as usize;
                    let bytes: Vec<u8> = (0..n).map(|_| rand::random::<u8>()).collect();
                    host_reply(Ok(serde_json::json!(bytes)))
                }
                "sendRequest" => host_reply(host.send_request(arg)),
                "cookie" => host_reply(host.cookie(arg)),
                other => host_reply(Err(format!("operación desconocida: {other}"))),
            }
        })
        .map_err(engine)?;
        globals.set("__cartero_host", f).map_err(engine)?;
        ctx.eval::<(), _>(PRELUDE).map_err(|e| fail(&ctx, e))
    })?;

    // Promesas y temporizadores: se van resolviendo hasta que no queda nada pendiente
    for _ in 0..10_000 {
        while rt.is_job_pending() {
            if rt.execute_pending_job().is_err() && Instant::now() > deadline {
                return Err(ScriptError::Timeout(limits.timeout));
            }
        }
        let more = ctx.with(|ctx| ctx.eval::<bool, _>("__cartero_tick()").map_err(|e| fail(&ctx, e)))?;
        if !more && !rt.is_job_pending() {
            break;
        }
    }

    ctx.with(|ctx| {
        ctx.eval::<(), _>("__cartero_finish()").map_err(|e| fail(&ctx, e))?;
        let raw: String = ctx.globals().get("__cartero_output").map_err(engine)?;
        serde_json::from_str(&raw).map_err(|e| ScriptError::Engine(e.to_string()))
    })
}

#[cfg(test)]
mod tests;
