//! Sandbox de scripts `pm.*` de Cartero sobre QuickJS.
//!
//! Cada ejecución usa un runtime nuevo, con límite de memoria y de tiempo: un script
//! no puede bloquear la app ni ver nada fuera de lo que le pasamos.

use std::time::{Duration, Instant};

use rquickjs::{Context, Runtime};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const LIBS: &str = include_str!("../assets/sandbox-libs.js");
const PRELUDE: &str = include_str!("../assets/prelude.js");

#[derive(Debug, Clone, Default, Serialize)]
pub struct ScriptInput {
    pub script: String,
    /// "prerequest" o "test"
    pub event: String,
    #[serde(rename = "requestName")]
    pub request_name: String,
    pub iteration: u32,
    /// Ámbitos: environment, globals, collection
    pub variables: serde_json::Map<String, Value>,
    #[serde(rename = "iterationData")]
    pub iteration_data: serde_json::Map<String, Value>,
    pub request: Value,
    pub response: Option<ScriptResponse>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScriptResponse {
    pub code: u16,
    pub status: String,
    pub headers: Vec<Header>,
    pub body: String,
    #[serde(rename = "responseTime")]
    pub response_time: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Header {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct TestResult {
    pub name: String,
    pub passed: bool,
    #[serde(default)]
    pub skipped: bool,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ConsoleLine {
    pub level: String,
    pub text: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ScriptOutput {
    pub tests: Vec<TestResult>,
    pub console: Vec<ConsoleLine>,
    /// Estado final de cada ámbito de variables
    pub variables: serde_json::Map<String, Value>,
    /// Error no capturado del script (no de un test)
    pub error: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ScriptError {
    #[error("el script ha superado el tiempo máximo de {0:?}")]
    Timeout(Duration),
    #[error("error del motor de scripts: {0}")]
    Engine(String),
}

pub struct Limits {
    pub timeout: Duration,
    pub memory_bytes: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self { timeout: Duration::from_secs(30), memory_bytes: 256 * 1024 * 1024 }
    }
}

/// Ejecuta un script pre-request o post-response y devuelve tests, consola y variables.
pub fn run(input: &ScriptInput, limits: &Limits) -> Result<ScriptOutput, ScriptError> {
    let rt = Runtime::new().map_err(|e| ScriptError::Engine(e.to_string()))?;
    rt.set_memory_limit(limits.memory_bytes);
    rt.set_max_stack_size(4 * 1024 * 1024);
    let deadline = Instant::now() + limits.timeout;
    rt.set_interrupt_handler(Some(Box::new(move || Instant::now() > deadline)));
    let ctx = Context::full(&rt).map_err(|e| ScriptError::Engine(e.to_string()))?;
    let json_in = serde_json::to_string(input).map_err(|e| ScriptError::Engine(e.to_string()))?;

    ctx.with(|ctx| -> Result<ScriptOutput, ScriptError> {
        let globals = ctx.globals();
        globals.set("__cartero_input", json_in).map_err(|e| ScriptError::Engine(e.to_string()))?;
        let eval = |src: &str| {
            ctx.eval::<(), _>(src).map_err(|e| {
                if Instant::now() > deadline {
                    ScriptError::Timeout(limits.timeout)
                } else {
                    let detail = ctx.catch().into_exception().map(|ex| ex.to_string()).unwrap_or_else(|| e.to_string());
                    ScriptError::Engine(detail)
                }
            })
        };
        eval(LIBS)?;
        eval(PRELUDE)?;
        let raw: String = globals.get("__cartero_output").map_err(|e| ScriptError::Engine(e.to_string()))?;
        serde_json::from_str(&raw).map_err(|e| ScriptError::Engine(e.to_string()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn response(code: u16, body: Value) -> ScriptResponse {
        ScriptResponse {
            code,
            status: "OK".into(),
            headers: vec![Header { key: "Content-Type".into(), value: "application/json".into() }],
            body: body.to_string(),
            response_time: 42,
        }
    }

    fn input(script: &str, resp: Option<ScriptResponse>) -> ScriptInput {
        let mut vars = serde_json::Map::new();
        vars.insert("environment".into(), json!({ "baseUrl": "http://localhost" }));
        ScriptInput {
            script: script.into(),
            event: "test".into(),
            request_name: "Get user".into(),
            variables: vars,
            response: resp,
            ..Default::default()
        }
    }

    #[test]
    fn tests_de_postman_y_variables() {
        // Los mismos scripts que usa la suite del servidor con postman-runtime
        let script = r#"
            pm.test("ok", () => pm.response.to.have.status(200))
            pm.test("es json", () => pm.response.to.have.header("Content-Type", "application/json"))
            pm.test("falla", () => pm.expect(pm.response.json().id).to.equal(2))
            pm.environment.set("last", pm.response.json().url)
            console.log("id", pm.response.json().id)
        "#;
        let out = run(&input(script, Some(response(200, json!({ "id": 1, "url": "/users?page=1" })))), &Limits::default()).unwrap();
        assert_eq!(out.tests.len(), 3);
        assert!(out.tests[0].passed && out.tests[1].passed);
        assert!(!out.tests[2].passed);
        assert_eq!(out.tests[2].error.as_deref(), Some("expected 1 to equal 2"));
        assert_eq!(out.variables["environment"]["last"], "/users?page=1");
        assert_eq!(out.variables["environment"]["baseUrl"], "http://localhost");
        assert_eq!(out.console[0].text, "id 1");
        assert!(out.error.is_none());
    }

    #[test]
    fn librerias_como_en_postman() {
        let script = r#"
            const _ = require('lodash')
            const CryptoJS = require('crypto-js')
            pm.test("lodash", () => pm.expect(_.sum([1, 2, 3])).to.equal(6))
            pm.test("crypto-js", () => pm.expect(CryptoJS.SHA256("cartero").toString()).to.have.lengthOf(64))
            pm.test("ok", () => pm.response.to.be.ok)
        "#;
        let out = run(&input(script, Some(response(201, json!({})))), &Limits::default()).unwrap();
        assert!(out.tests.iter().all(|t| t.passed), "{:?}", out.tests);
    }

    #[test]
    fn errores_del_script_y_modulos_desconocidos() {
        let out = run(&input("require('fs')", None), &Limits::default()).unwrap();
        assert!(out.error.unwrap().contains("Cannot find module 'fs'"));
    }

    #[test]
    fn un_bucle_infinito_se_corta() {
        let limits = Limits { timeout: Duration::from_millis(300), ..Default::default() };
        let start = Instant::now();
        let r = run(&input("while (true) {}", None), &limits);
        // El script se interrumpe: o el motor lo reporta como error del script, o como timeout
        match r {
            Ok(out) => assert!(out.error.unwrap().contains("interrupted")),
            Err(e) => assert!(matches!(e, ScriptError::Timeout(_)), "{e}"),
        }
        assert!(start.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn el_coste_de_arranque_es_bajo() {
        let start = Instant::now();
        for _ in 0..10 {
            run(&input("pm.test('x', () => {})", None), &Limits::default()).unwrap();
        }
        let per_run = start.elapsed() / 10;
        eprintln!("arranque por ejecución: {per_run:?}");
        assert!(per_run < Duration::from_millis(250), "{per_run:?}");
    }
}
