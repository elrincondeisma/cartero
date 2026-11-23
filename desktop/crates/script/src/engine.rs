//! Motor de contratos y mock: el mismo código JavaScript que usan la web, el servidor y el MCP
//! (`packages/contracts` y `packages/mock`), empaquetado en `assets/engine.js` y ejecutado en
//! QuickJS. Cada hilo guarda su runtime con el bundle ya cargado, así ajv y faker solo se
//! interpretan una vez.

use std::cell::RefCell;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rquickjs::{Context, Runtime};
use serde_json::Value;

use crate::ScriptError;

const ENGINE: &str = include_str!("../assets/engine.js");
/// Tiempo máximo de una llamada (validar un cuerpo enorme, generar un ejemplo…).
const CALL_TIMEOUT: Duration = Duration::from_secs(10);
/// La primera carga interpreta el bundle entero.
const LOAD_TIMEOUT: Duration = Duration::from_secs(30);

struct Engine {
    // El runtime tiene que vivir tanto como el contexto
    _rt: Runtime,
    ctx: Context,
    deadline: Arc<Mutex<Instant>>,
}

impl Engine {
    fn new() -> Result<Self, ScriptError> {
        let engine = |e: rquickjs::Error| ScriptError::Engine(e.to_string());
        let rt = Runtime::new().map_err(engine)?;
        rt.set_memory_limit(512 * 1024 * 1024);
        rt.set_max_stack_size(4 * 1024 * 1024);
        let deadline = Arc::new(Mutex::new(Instant::now() + LOAD_TIMEOUT));
        let d = deadline.clone();
        rt.set_interrupt_handler(Some(Box::new(move || Instant::now() > *d.lock().unwrap())));
        let ctx = Context::full(&rt).map_err(engine)?;
        ctx.with(|ctx| {
            // ajv avisa por consola; aquí no hay nadie mirando
            let _ = ctx.eval::<(), _>("globalThis.console = { log() {}, info() {}, warn() {}, error() {}, debug() {} }");
            ctx.eval::<(), _>(ENGINE)
                .map_err(|e| ScriptError::Engine(ctx.catch().into_exception().map(|ex| ex.to_string()).unwrap_or_else(|| e.to_string())))
        })?;
        Ok(Self { _rt: rt, ctx, deadline })
    }
}

thread_local! {
    static ENGINE_TL: RefCell<Option<Engine>> = const { RefCell::new(None) };
}

/// Llama a `__cartero_engine[func](...args)` y devuelve su resultado como JSON.
/// Los errores lanzados en JavaScript llegan como [`ScriptError::Engine`] con su mensaje.
pub fn call(func: &str, args: &[Value]) -> Result<Value, ScriptError> {
    ENGINE_TL.with(|cell| {
        let mut slot = cell.borrow_mut();
        if slot.is_none() {
            *slot = Some(Engine::new()?);
        }
        let engine = slot.as_ref().expect("motor cargado");
        *engine.deadline.lock().unwrap() = Instant::now() + CALL_TIMEOUT;
        let args_json = serde_json::to_string(args).map_err(|e| ScriptError::Engine(e.to_string()))?;
        let code = format!(
            "(() => {{ const r = __cartero_engine[{}](...JSON.parse(__cartero_args)); return JSON.stringify(r === undefined ? null : r) }})()",
            serde_json::to_string(func).unwrap_or_default()
        );
        let result = engine.ctx.with(|ctx| -> Result<String, ScriptError> {
            ctx.globals().set("__cartero_args", args_json).map_err(|e| ScriptError::Engine(e.to_string()))?;
            ctx.eval::<String, _>(code).map_err(|e| {
                if Instant::now() > *engine.deadline.lock().unwrap() {
                    ScriptError::Timeout(CALL_TIMEOUT)
                } else {
                    ScriptError::Engine(ctx.catch().into_exception().map(|ex| ex.message().unwrap_or_else(|| ex.to_string())).unwrap_or_else(|| e.to_string()))
                }
            })
        });
        match result {
            Ok(text) => serde_json::from_str(&text).map_err(|e| ScriptError::Engine(e.to_string())),
            Err(e) => {
                // Tras un corte por tiempo el contexto puede quedar a medias: se rehace en la próxima llamada
                if matches!(e, ScriptError::Timeout(_)) {
                    *slot = None;
                }
                Err(e)
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::call;

    fn user_contract() -> serde_json::Value {
        json!({
            "request": { "path": [{ "name": "id", "required": true, "schema": { "type": "integer" } }] },
            "responses": {
                "200": { "body": {
                    "type": "object",
                    "properties": { "id": { "type": "integer" }, "email": { "type": "string", "format": "email" } },
                    "required": ["id", "email"]
                } },
                "404": {}
            }
        })
    }

    #[test]
    fn valida_peticion_y_respuesta_como_la_web() {
        let sent = json!({ "url": "http://localhost:3000/api/users/abc", "headers": [], "body": null });
        let res = json!({ "code": 200, "headers": [], "body": "{\"id\":\"7\",\"email\":\"no-es-email\",\"extra\":1}" });
        let r = call("check", &[user_contract(), json!("{{baseUrl}}/users/:id"), sent, res]).unwrap();
        let text = |side: &str| -> Vec<String> {
            r[side]
                .as_array()
                .unwrap()
                .iter()
                .map(|i| call("formatIssue", std::slice::from_ref(i)).unwrap().as_str().unwrap().to_string())
                .collect()
        };
        assert_eq!(text("request"), vec!["id: Se esperaba integer y ha llegado string"]);
        let resp = text("response");
        assert!(resp.contains(&"$.id: Se esperaba integer y ha llegado string".to_string()), "{resp:?}");
        assert!(resp.contains(&"$.email: No tiene formato email".to_string()), "{resp:?}");
        assert_eq!(r["errors"], 3);
        assert_eq!(r["warnings"], 1);
    }

    #[test]
    fn codigo_no_previsto() {
        let res = json!({ "code": 500, "headers": [], "body": "" });
        let r = call("check", &[user_contract(), json!("/users/:id"), serde_json::Value::Null, res]).unwrap();
        assert_eq!(r["response"][0]["where"], "status");
        assert_eq!(r["response"][0]["params"][0], "200, 404");
    }

    #[test]
    fn cambios_que_rompen() {
        let mut v2 = user_contract();
        v2["responses"]["200"]["body"]["properties"].as_object_mut().unwrap().remove("email");
        let r = call("diff", &[user_contract(), v2]).unwrap();
        assert_eq!(r["summary"], "1 cambio que rompe");
        assert_eq!(r["changes"][0]["breaking"], true);
        assert_eq!(r["changes"][0]["text"], "Respuesta 200 · $.email: Se quita el campo");
    }

    #[test]
    fn infiere_desde_una_respuesta() {
        let s = call("infer", &[json!("{\"id\":1,\"email\":\"ana@example.com\"}")]).unwrap();
        assert_eq!(s["properties"]["id"]["type"], "integer");
        assert_eq!(s["properties"]["email"]["format"], "email");
        assert_eq!(call("infer", &[json!("<html>")]).unwrap(), serde_json::Value::Null);
    }

    #[test]
    fn mock_desde_el_contrato_y_openapi() {
        let collection = json!({
            "info": { "name": "Usuarios" },
            "item": [{ "name": "Ver usuario", "request": { "method": "GET", "url": { "raw": "{{baseUrl}}/users/:id" } }, "contract": user_contract() }]
        });
        let req = json!({ "method": "GET", "path": "/users/7", "query": {}, "headers": {} });
        let r = call("mock", &[collection.clone(), req, json!({})]).unwrap();
        assert_eq!(r["status"], 200);
        assert_eq!(r["matched"], "Ver usuario / Contrato 200");
        let body: serde_json::Value = serde_json::from_str(r["body"].as_str().unwrap()).unwrap();
        assert!(body["id"].is_i64() && body["email"].as_str().unwrap().contains('@'));

        let spec = call("toOpenApi", &[collection, json!("yaml")]).unwrap();
        let text = spec["text"].as_str().unwrap();
        assert!(text.starts_with("openapi: 3.1.0"), "{text}");
        assert_eq!(call("isOpenApi", &[json!(text)]).unwrap(), true);
        let back = call("fromOpenApi", &[json!(text)]).unwrap();
        assert_eq!(back["collection"]["item"][0]["contract"]["responses"]["200"]["body"]["properties"]["email"]["format"], "email");
    }

    #[test]
    fn los_errores_de_javascript_llegan_con_su_mensaje() {
        let e = call("fromOpenApi", &[json!("{\"swagger\":\"2.0\"}")]).unwrap_err();
        assert!(e.to_string().contains("Swagger 2.0"), "{e}");
    }

    #[test]
    fn llamadas_rapidas_tras_la_primera_carga() {
        call("hasContract", &[json!(null)]).unwrap();
        let t = std::time::Instant::now();
        for _ in 0..50 {
            call(
                "check",
                &[user_contract(), json!("/users/:id"), serde_json::Value::Null, json!({ "code": 404, "headers": [], "body": "" })],
            )
            .unwrap();
        }
        assert!(t.elapsed().as_millis() < 2000, "50 validaciones en {:?}", t.elapsed());
    }
}
