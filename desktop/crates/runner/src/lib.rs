//! Ejecución de peticiones con su cadena de scripts y del runner de colecciones.

pub mod data;
mod host;
pub mod report;
mod run;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use cartero_http::{CookieJar, Options, Response};
use cartero_model::prepare::{Prepared, prepare};
use cartero_model::vars::{Layers, Scope};
use cartero_model::{Collection, Item, KeyValue, Request, tree};
use cartero_script::{ConsoleLine, Limits, NextRequest, ScriptInput, ScriptResponse, TestResult};
use serde::Serialize;
use serde_json::{Map, Value, json};
use tokio::sync::Mutex;

pub use run::{RunConfig, RunEvent, RunItemResult, RunSummary, run_collection};

/// Variables vivas durante una ejecución. Los scripts las cambian y la app guarda los cambios.
#[derive(Debug, Clone, Default)]
pub struct VarState {
    pub globals: Scope,
    pub collection: Scope,
    pub environment: Scope,
    pub environment_name: String,
    pub data: Scope,
    pub local: Scope,
}

impl VarState {
    pub fn layers(&self) -> Layers {
        Layers::new(vec![self.globals.clone(), self.collection.clone(), self.environment.clone(), self.data.clone(), self.local.clone()])
    }
    fn to_json(s: &Scope) -> Value {
        Value::Object(s.iter().map(|(k, v)| (k.clone(), Value::String(v.clone()))).collect())
    }
    fn from_json(v: &Map<String, Value>) -> Scope {
        v.iter().map(|(k, v)| (k.clone(), v.as_str().map(String::from).unwrap_or_else(|| v.to_string()))).collect()
    }
}

/// Todo lo necesario para enviar: la colección (scripts, auth y variables heredadas), las
/// variables, los ajustes de red y el bote de cookies.
#[derive(Clone)]
pub struct RunContext {
    pub collection: Collection,
    pub vars: VarState,
    pub options: Options,
    pub jar: Arc<Mutex<CookieJar>>,
    pub limits: Limits,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConsoleEntry {
    /// "prerequest", "test" o "request"
    pub source: String,
    pub level: String,
    pub text: String,
}

/// Resultado de enviar una petición.
#[derive(Debug, Clone)]
pub struct Outcome {
    pub prepared: Prepared,
    pub response: Option<Response>,
    pub error: Option<String>,
    pub tests: Vec<TestResult>,
    pub console: Vec<ConsoleEntry>,
    pub script_errors: Vec<String>,
    pub next: NextRequest,
    pub skipped: bool,
    pub visualizer: Option<Value>,
    pub duration: Duration,
}

impl Outcome {
    pub fn failed_tests(&self) -> usize {
        self.tests.iter().filter(|t| !t.passed).count()
    }
}

/// Cadena de scripts de un evento: colección → carpetas → la petición.
fn script_chain(ctx: &RunContext, item: &Item, listen: &str) -> Vec<String> {
    let mut chain = vec![];
    if let Some(s) = cartero_model::script_of(&ctx.collection.event, listen) {
        chain.push(s);
    }
    for folder in tree::ancestors(&ctx.collection.item, item.id()).unwrap_or_default() {
        if let Some(s) = cartero_model::script_of(&folder.event, listen) {
            chain.push(s);
        }
    }
    if let Some(s) = cartero_model::script_of(&item.event, listen) {
        chain.push(s);
    }
    chain
}

fn request_json(r: &Request) -> Value {
    json!({
        "method": r.method,
        "url": r.url.raw(),
        "header": r.headers(),
        "body": r.body,
        "auth": r.auth(),
    })
}

/// Aplica a la petición los cambios que hizo el pre-request (`pm.request.*`).
fn apply_request_changes(r: &mut Request, changed: &Value) {
    if let Some(m) = changed["method"].as_str() {
        r.method = m.to_string();
    }
    if let Some(u) = changed["url"].as_str()
        && u != r.url.raw()
    {
        let prev = match &r.url {
            cartero_model::Url::Parts(p) => p.clone(),
            cartero_model::Url::Raw(s) => cartero_model::url::parse(s),
        };
        let mut next = cartero_model::url::parse(u);
        next.variable = prev.variable;
        r.url = cartero_model::Url::Parts(next);
    }
    if let Ok(h) = serde_json::from_value::<Vec<KeyValue>>(changed["header"].clone()) {
        r.header = Some(h);
    }
    if changed["body"].is_object()
        && let Ok(b) = serde_json::from_value(changed["body"].clone())
    {
        r.body = Some(b);
    }
}

fn cookies_for(jar: &CookieJar, url: &str) -> Vec<Value> {
    let Ok(u) = url::Url::parse(url) else { return vec![] };
    let host = u.host_str().unwrap_or_default().to_string();
    jar.list()
        .into_iter()
        .filter(|c| host == c.domain || host.ends_with(&format!(".{}", c.domain)))
        .map(|c| json!({ "name": c.name, "value": c.value, "domain": c.domain, "path": c.path, "httpOnly": c.http_only, "secure": c.secure }))
        .collect()
}

pub struct ExecOptions {
    pub iteration: u32,
    pub iteration_count: u32,
}

impl Default for ExecOptions {
    fn default() -> Self {
        Self { iteration: 0, iteration_count: 1 }
    }
}

/// Envía una petición con sus scripts. Actualiza `ctx.vars` con lo que cambien los scripts.
pub async fn execute(ctx: &mut RunContext, item: &Item, opts: &ExecOptions) -> Outcome {
    let start = Instant::now();
    let mut request = item.request.clone().unwrap_or_default();
    let mut console = vec![];
    let mut tests = vec![];
    let mut script_errors = vec![];
    let mut next = NextRequest::Unchanged;
    let mut skipped = false;
    let mut visualizer = None;
    let host: Arc<dyn cartero_script::Host> = Arc::new(host::RunnerHost::new(ctx));

    let base_input = |ctx: &RunContext, event: &str, script: String, request: &Request| ScriptInput {
        script,
        event: event.into(),
        request_name: item.name.clone(),
        request_id: item.id().to_string(),
        collection_name: ctx.collection.info.name.clone(),
        iteration: opts.iteration,
        iteration_count: opts.iteration_count,
        variables: [
            ("environment".to_string(), VarState::to_json(&ctx.vars.environment)),
            ("globals".to_string(), VarState::to_json(&ctx.vars.globals)),
            ("collection".to_string(), VarState::to_json(&ctx.vars.collection)),
        ]
        .into_iter()
        .collect(),
        environment_name: ctx.vars.environment_name.clone(),
        iteration_data: ctx.vars.data.iter().map(|(k, v)| (k.clone(), Value::String(v.clone()))).collect(),
        local: ctx.vars.local.iter().map(|(k, v)| (k.clone(), Value::String(v.clone()))).collect(),
        request: request_json(request),
        response: None,
        cookies: vec![],
    };

    // 1. Pre-request
    for script in script_chain(ctx, item, "prerequest") {
        let input = base_input(ctx, "prerequest", script, &request);
        match run_script(input, ctx.limits.clone(), host.clone()).await {
            Ok(out) => {
                absorb(ctx, &out);
                if let Some(changed) = &out.request {
                    apply_request_changes(&mut request, changed);
                }
                console.extend(out.console.iter().map(|l| entry("prerequest", l)));
                tests.extend(out.tests.clone());
                if let Some(e) = out.error.clone() {
                    script_errors.push(format!("Pre-request: {e}"));
                }
                if out.next() != NextRequest::Unchanged {
                    next = out.next();
                }
                skipped |= out.skip_request;
            }
            Err(e) => script_errors.push(format!("Pre-request: {e}")),
        }
    }

    // 2. La petición
    let auth = {
        let mut c = ctx.collection.clone();
        let mut it = item.clone();
        it.request = Some(request.clone());
        if let Some(slot) = tree::find_mut(&mut c.item, item.id()) {
            *slot = it;
        } else {
            c.item.push(it);
        }
        tree::effective_auth(&c, item.id()).map(|(a, _)| a.clone())
    };
    let prepared = prepare(&request, &ctx.vars.layers(), auth.as_ref());
    if skipped {
        return Outcome {
            prepared,
            response: None,
            error: None,
            tests,
            console,
            script_errors,
            next,
            skipped,
            visualizer,
            duration: start.elapsed(),
        };
    }
    let result = {
        let mut jar = ctx.jar.lock().await;
        cartero_http::send(&prepared, &ctx.options, Some(&mut jar)).await
    };
    let (response, error) = match result {
        Ok(r) => (Some(r), None),
        Err(e) => {
            console.push(ConsoleEntry { source: "request".into(), level: "error".into(), text: e.to_string() });
            (None, Some(e.to_string()))
        }
    };

    // 3. Tests (también se ejecutan si la petición falla, sin pm.response)
    if let Some(res) = &response {
        let cookies = cookies_for(&*ctx.jar.lock().await, &res.url);
        let script_response = ScriptResponse {
            code: res.status,
            status: res.reason.clone(),
            headers: res.headers.iter().map(|(k, v)| cartero_script::Header { key: k.clone(), value: v.clone() }).collect(),
            body: res.text(),
            response_time: res.timings.total.as_millis() as u64,
            response_size: res.body_size + res.headers_size,
        };
        for script in script_chain(ctx, item, "test") {
            let mut input = base_input(ctx, "test", script, &request);
            input.response = Some(script_response.clone());
            input.cookies = cookies.clone();
            match run_script(input, ctx.limits.clone(), host.clone()).await {
                Ok(out) => {
                    absorb(ctx, &out);
                    console.extend(out.console.iter().map(|l| entry("test", l)));
                    tests.extend(out.tests.clone());
                    if let Some(e) = out.error.clone() {
                        script_errors.push(format!("Tests: {e}"));
                    }
                    if out.next() != NextRequest::Unchanged {
                        next = out.next();
                    }
                    if out.visualizer.is_some() {
                        visualizer = out.visualizer.clone();
                    }
                }
                Err(e) => script_errors.push(format!("Tests: {e}")),
            }
        }
    }
    Outcome { prepared, response, error, tests, console, script_errors, next, skipped, visualizer, duration: start.elapsed() }
}

fn entry(source: &str, l: &ConsoleLine) -> ConsoleEntry {
    ConsoleEntry { source: source.into(), level: l.level.clone(), text: l.text.clone() }
}

fn absorb(ctx: &mut RunContext, out: &cartero_script::ScriptOutput) {
    ctx.vars.environment = VarState::from_json(&out.scope("environment"));
    ctx.vars.globals = VarState::from_json(&out.scope("globals"));
    ctx.vars.collection = VarState::from_json(&out.scope("collection"));
    ctx.vars.local = VarState::from_json(&out.local);
}

async fn run_script(
    input: ScriptInput,
    limits: Limits,
    host: Arc<dyn cartero_script::Host>,
) -> Result<cartero_script::ScriptOutput, String> {
    tokio::task::spawn_blocking(move || cartero_script::run(&input, &limits, host))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Variables que han cambiado entre dos estados (para guardarlas en el entorno, globales…).
pub fn diff(before: &Scope, after: &Scope) -> (HashMap<String, String>, Vec<String>) {
    let changed = after.iter().filter(|(k, v)| before.get(*k) != Some(*v)).map(|(k, v)| (k.clone(), v.clone())).collect();
    let removed = before.keys().filter(|k| !after.contains_key(*k)).cloned().collect();
    (changed, removed)
}

#[cfg(test)]
mod tests;
