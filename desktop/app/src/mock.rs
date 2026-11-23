//! Mock local: un servidor HTTP en `127.0.0.1` que responde como el mock del servidor de
//! Cartero (mismo código, `packages/mock`, en el motor de QuickJS): con los ejemplos guardados
//! y, si no hay ninguno que encaje, con datos generados desde el contrato de la petición.
//! Así el frontend puede trabajar contra `http://127.0.0.1:4010` sin backend ni conexión.

use std::collections::HashMap;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::{Arc, RwLock};

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::service::service_fn;
use hyper::{Request, Response};
use hyper_util::rt::TokioIo;
use serde_json::{Map, Value, json};

/// Primer puerto que se prueba; si está ocupado, los siguientes.
pub const FIRST_PORT: u16 = 4010;
const PORT_TRIES: u16 = 50;

/// Lo que necesita el mock para responder: la colección y las variables (globales < colección < entorno).
#[derive(Default)]
pub struct MockData {
    pub collection: Value,
    pub vars: HashMap<String, String>,
}

pub struct LocalMock {
    pub port: u16,
    data: Arc<RwLock<MockData>>,
    task: tokio::task::AbortHandle,
}

impl LocalMock {
    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    /// Cambia la colección o las variables sin reiniciar (al guardar una petición, por ejemplo).
    pub fn update(&self, data: MockData) {
        if let Ok(mut d) = self.data.write() {
            *d = data;
        }
    }

    pub fn stop(&self) {
        self.task.abort();
    }
}

impl Drop for LocalMock {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// Arranca un mock en el primer puerto libre desde `first` (4010 por defecto).
pub fn start(data: MockData, first: u16) -> std::io::Result<LocalMock> {
    let mut last_err = None;
    for port in first..first.saturating_add(PORT_TRIES) {
        match std::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port))) {
            Ok(listener) => {
                listener.set_nonblocking(true)?;
                let data = Arc::new(RwLock::new(data));
                let shared = data.clone();
                let task = crate::runtime::spawn(async move {
                    let Ok(listener) = tokio::net::TcpListener::from_std(listener) else { return };
                    loop {
                        let Ok((stream, _)) = listener.accept().await else { continue };
                        let data = shared.clone();
                        tokio::spawn(async move {
                            let svc = service_fn(move |req| handle(req, data.clone()));
                            let _ = hyper::server::conn::http1::Builder::new().serve_connection(TokioIo::new(stream), svc).await;
                        });
                    }
                });
                return Ok(LocalMock { port, data, task: task.abort_handle() });
            }
            Err(e) => last_err = Some(e),
        }
    }
    Err(last_err.unwrap_or_else(|| std::io::Error::other("sin puertos libres")))
}

fn cors(builder: hyper::http::response::Builder) -> hyper::http::response::Builder {
    builder
        .header("access-control-allow-origin", "*")
        .header("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD")
        .header("access-control-allow-headers", "*")
        .header("access-control-expose-headers", "*")
}

async fn handle(req: Request<Incoming>, data: Arc<RwLock<MockData>>) -> Result<Response<Full<Bytes>>, Infallible> {
    // El navegador pregunta antes de enviar desde otro origen: siempre se permite
    if req.method() == hyper::Method::OPTIONS && req.headers().contains_key("access-control-request-method") {
        return Ok(cors(Response::builder().status(204)).body(Full::new(Bytes::new())).unwrap());
    }
    let method = req.method().to_string();
    let path = req.uri().path().to_string();
    let query: Map<String, Value> = req
        .uri()
        .query()
        .map(|q| url::form_urlencoded::parse(q.as_bytes()).map(|(k, v)| (k.into_owned(), Value::String(v.into_owned()))).collect())
        .unwrap_or_default();
    let headers: Map<String, Value> =
        req.headers().iter().map(|(k, v)| (k.as_str().to_lowercase(), Value::String(v.to_str().unwrap_or_default().to_string()))).collect();
    let body = req.into_body().collect().await.map(|b| String::from_utf8_lossy(&b.to_bytes()).into_owned()).unwrap_or_default();
    let request = json!({ "method": method, "path": path, "query": query, "headers": headers, "body": (!body.is_empty()).then_some(body) });
    let (collection, vars) = match data.read() {
        Ok(d) => (d.collection.clone(), serde_json::to_value(&d.vars).unwrap_or_default()),
        Err(_) => (Value::Null, json!({})),
    };
    let result = cartero_script::engine::call("mock", &[collection, request, vars]);
    let response = match result {
        Ok(r) => {
            let status = r["status"].as_u64().unwrap_or(200) as u16;
            let mut b = cors(Response::builder().status(status));
            for h in r["headers"].as_array().into_iter().flatten() {
                if let (Some(k), Some(v)) = (h["key"].as_str(), h["value"].as_str())
                    && !h["disabled"].as_bool().unwrap_or(false)
                {
                    b = b.header(k, v);
                }
            }
            if let Some(m) = r["matched"].as_str() {
                b = b.header("x-cartero-mock-match", url::form_urlencoded::byte_serialize(m.as_bytes()).collect::<String>());
            }
            b.body(Full::new(Bytes::from(r["body"].as_str().unwrap_or_default().to_string())))
        }
        Err(e) => cors(Response::builder().status(500))
            .header("content-type", "application/json")
            .body(Full::new(Bytes::from(json!({ "error": "mockError", "message": e.to_string() }).to_string()))),
    };
    Ok(response.unwrap_or_else(|_| Response::builder().status(500).body(Full::new(Bytes::from("mock: respuesta no válida"))).unwrap()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collection() -> Value {
        json!({
            "info": { "name": "Usuarios" },
            "item": [
                {
                    "name": "Ver usuario",
                    "request": { "method": "GET", "url": { "raw": "{{baseUrl}}/users/:id" } },
                    "contract": { "responses": {
                        "200": { "body": { "type": "object", "properties": { "id": { "type": "integer" }, "email": { "type": "string", "format": "email" } }, "required": ["id", "email"] } },
                        "404": { "body": { "type": "object", "properties": { "error": { "type": "string" } }, "required": ["error"] } }
                    } }
                },
                {
                    "name": "Listar",
                    "request": { "method": "GET", "url": { "raw": "{{baseUrl}}/users" } },
                    "response": [{ "name": "Lista", "code": 200, "header": [{ "key": "Content-Type", "value": "application/json" }], "body": "[{\"id\":1,\"region\":\"{{region}}\"}]" }]
                }
            ]
        })
    }

    async fn get(port: u16, path: &str, headers: &[(&str, &str)]) -> (u16, String, Option<String>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut s = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let extra: String = headers.iter().map(|(k, v)| format!("{k}: {v}\r\n")).collect();
        s.write_all(format!("GET {path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n{extra}\r\n").as_bytes()).await.unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).await.unwrap();
        let status = out[9..12].parse().unwrap();
        let (head, body) = out.split_once("\r\n\r\n").unwrap();
        let matched = head.lines().find_map(|l| l.strip_prefix("x-cartero-mock-match: ").map(str::to_string));
        (status, body.to_string(), matched)
    }

    #[test]
    fn responde_desde_el_contrato_y_los_ejemplos() {
        let vars = HashMap::from([("region".to_string(), "eu".to_string())]);
        let mock = start(MockData { collection: collection(), vars }, 4710).unwrap();
        let port = mock.port;
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        rt.block_on(async {
            let (status, body, matched) = get(port, "/users/7", &[]).await;
            assert_eq!(status, 200);
            assert_eq!(matched.as_deref(), Some("Ver+usuario+%2F+Contrato+200"));
            let v: Value = serde_json::from_str(&body).unwrap();
            assert!(v["id"].is_i64() && v["email"].as_str().unwrap().contains('@'), "{body}");

            let (status, body, _) = get(port, "/users/7", &[("x-mock-response-code", "404")]).await;
            assert_eq!(status, 404);
            assert!(body.contains("error"));

            let (status, body, _) = get(port, "/users", &[]).await;
            assert_eq!(status, 200);
            assert_eq!(body, "[{\"id\":1,\"region\":\"eu\"}]");

            let (status, _, _) = get(port, "/nada", &[]).await;
            assert_eq!(status, 404);
        });
        // Un segundo mock coge el puerto siguiente
        let other = start(MockData::default(), port).unwrap();
        assert_ne!(other.port, port);
    }
}
