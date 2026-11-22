//! Sincronización con un servidor de Cartero.
//!
//! La app siempre lee de SQLite. Sincronizar es: bajar los cambios desde el último cursor
//! (aplicándolos a lo que no tiene cambios locales), subir lo pendiente con su «base» (si el
//! servidor tiene otra cosa, es un conflicto que decide la persona) y subir el historial y las
//! ejecuciones. El WebSocket del servidor avisa al momento de los cambios de otras personas.

pub mod realtime;

use std::time::Duration;

use cartero_http::Options;
use cartero_model::prepare::{Prepared, PreparedBody};
use cartero_store::Store;
use cartero_store::sync::{Entity, strip_version};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    #[error("no se puede conectar con el servidor: {0}")]
    Network(String),
    #[error("el servidor ha rechazado el token (¿se ha revocado?)")]
    Unauthorized,
    #[error("no tienes acceso a este workspace en el servidor")]
    Forbidden,
    #[error("el servidor respondió {status}: {message}")]
    Server { status: u16, message: String },
    #[error("{0}")]
    Store(#[from] cartero_store::StoreError),
}

pub type Result<T> = std::result::Result<T, SyncError>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RemoteUser {
    pub id: String,
    pub email: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RemoteWorkspace {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default, rename = "type")]
    pub kind: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Report {
    pub pulled: usize,
    pub pushed: usize,
    pub conflicts: usize,
    pub errors: Vec<String>,
}

#[derive(Clone)]
pub struct Client {
    pub base: String,
    token: String,
    opts: Options,
}

impl std::fmt::Debug for Client {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Client").field("base", &self.base).finish()
    }
}

impl Client {
    pub fn new(base: &str, token: &str, mut opts: Options) -> Self {
        opts.timeout = opts.timeout.min(Duration::from_secs(60));
        Self { base: base.trim_end_matches('/').to_string(), token: token.to_string(), opts }
    }

    async fn call(&self, method: &str, path: &str, body: Option<Value>) -> Result<Value> {
        let mut p = Prepared {
            method: method.into(),
            url: format!("{}{path}", self.base),
            headers: vec![
                ("Authorization".into(), format!("Bearer {}", self.token)),
                ("Accept".into(), "application/json".into()),
                ("User-Agent".into(), concat!("Cartero-Desktop/", env!("CARGO_PKG_VERSION")).into()),
            ],
            ..Default::default()
        };
        if let Some(b) = body {
            p.headers.push(("Content-Type".into(), "application/json".into()));
            p.body = PreparedBody::Raw(b.to_string());
        }
        let res = cartero_http::send(&p, &self.opts, None).await.map_err(|e| SyncError::Network(e.to_string()))?;
        let json: Value = serde_json::from_slice(&res.body).unwrap_or(Value::Null);
        match res.status {
            200..=299 => Ok(json),
            401 => Err(SyncError::Unauthorized),
            403 => Err(SyncError::Forbidden),
            s => Err(SyncError::Server { status: s, message: json["message"].as_str().map(String::from).unwrap_or_else(|| res.text().chars().take(200).collect()) }),
        }
    }

    pub async fn me(&self) -> Result<RemoteUser> {
        let v = self.call("GET", "/api/auth/me", None).await?;
        serde_json::from_value(v).map_err(|e| SyncError::Server { status: 200, message: e.to_string() })
    }

    pub async fn workspaces(&self) -> Result<Vec<RemoteWorkspace>> {
        let v = self.call("GET", "/api/workspaces", None).await?;
        serde_json::from_value(v).map_err(|e| SyncError::Server { status: 200, message: e.to_string() })
    }

    pub async fn create_workspace(&self, name: &str) -> Result<RemoteWorkspace> {
        let v = self.call("POST", "/api/workspaces", Some(json!({ "name": name }))).await?;
        serde_json::from_value(v).map_err(|e| SyncError::Server { status: 200, message: e.to_string() })
    }

    /// Baja los cambios desde `cursor` y los aplica. Devuelve el cursor nuevo y cuántos aplicó.
    pub async fn pull(&self, store: &Store, local_ws: &str, remote_ws: &str, cursor: Option<&str>) -> Result<(String, usize)> {
        let path = match cursor {
            Some(c) => format!("/api/workspaces/{remote_ws}/changes?since={}", url::form_urlencoded::byte_serialize(c.as_bytes()).collect::<String>()),
            None => format!("/api/workspaces/{remote_ws}/changes"),
        };
        let v = self.call("GET", &path, None).await?;
        let mut applied = 0;
        let content = |row: &Value| strip_version(row);
        let ver = |row: &Value| row["version"].as_i64().unwrap_or(1);
        for c in v["collections"].as_array().into_iter().flatten() {
            applied += usize::from(store.apply_remote_collection(local_ws, c["id"].as_str().unwrap_or_default(), &content(c), ver(c), false)?);
        }
        for i in v["items"].as_array().into_iter().flatten() {
            applied += usize::from(store.apply_remote_item(i["id"].as_str().unwrap_or_default(), &content(i), ver(i), false)?);
        }
        for e in v["environments"].as_array().into_iter().flatten() {
            applied += usize::from(store.apply_remote_environment(local_ws, e["id"].as_str().unwrap_or_default(), &content(e), ver(e), false)?);
        }
        if v["globals"].is_object() {
            let g = &v["globals"];
            applied += usize::from(store.apply_remote_globals(local_ws, &content(g), ver(g), false)?);
        }
        for d in v["deleted"].as_array().into_iter().flatten() {
            if let Some(entity) = d["entity"].as_str().and_then(Entity::parse) {
                applied += usize::from(store.apply_remote_deletion(entity, d["id"].as_str().unwrap_or_default())?);
            }
        }
        // Una sincronización completa también quita lo que ya no existe en el servidor
        if v["full"] == true {
            applied += self.prune_missing(store, local_ws, &v)?;
        }
        Ok((v["cursor"].as_str().unwrap_or_default().to_string(), applied))
    }

    fn prune_missing(&self, store: &Store, local_ws: &str, v: &Value) -> Result<usize> {
        let ids = |k: &str| -> Vec<String> { v[k].as_array().into_iter().flatten().filter_map(|r| r["id"].as_str().map(String::from)).collect() };
        let (cols, items, envs) = (ids("collections"), ids("items"), ids("environments"));
        let mut removed = 0;
        for meta in store.collections(local_ws)? {
            if !cols.contains(&meta.id) {
                removed += usize::from(store.apply_remote_deletion_if_synced(Entity::Collection, &meta.id)?);
            }
            for row in store.item_rows(&meta.id)? {
                if !items.contains(&row.id) {
                    removed += usize::from(store.apply_remote_deletion_if_synced(Entity::Item, &row.id)?);
                }
            }
        }
        for e in store.environments(local_ws)? {
            if !envs.contains(&e.id) {
                removed += usize::from(store.apply_remote_deletion_if_synced(Entity::Environment, &e.id)?);
            }
        }
        Ok(removed)
    }

    /// Sube lo pendiente. Lo aceptado queda limpio; lo que choca se guarda como conflicto.
    pub async fn push(&self, store: &Store, local_ws: &str, remote_ws: &str) -> Result<Report> {
        let pending = store.pending(local_ws)?;
        let mut report = Report::default();
        for chunk in pending.chunks(200) {
            let ops: Vec<Value> = chunk
                .iter()
                .map(|p| {
                    let mut op = json!({ "entity": p.entity.as_str(), "op": if p.delete { "delete" } else { "upsert" }, "base": p.base, "force": p.force });
                    if p.entity != Entity::Globals {
                        op["id"] = json!(p.id);
                    }
                    if !p.delete {
                        op["data"] = p.data.clone();
                    }
                    op
                })
                .collect();
            let v = self.call("POST", &format!("/api/workspaces/{remote_ws}/sync"), Some(json!({ "ops": ops }))).await?;
            for r in v["results"].as_array().into_iter().flatten() {
                let entity = r["entity"].as_str().and_then(Entity::parse);
                let id = r["id"].as_str().map(String::from).unwrap_or_else(|| local_ws.to_string());
                let Some(p) = chunk.iter().find(|p| Some(p.entity) == entity && p.id == id) else { continue };
                match r["status"].as_str() {
                    Some("ok") => {
                        store.mark_synced(p, r["version"].as_i64())?;
                        report.pushed += 1;
                    }
                    Some("conflict") => {
                        store.add_conflict(local_ws, p, &r["remote"])?;
                        report.conflicts += 1;
                    }
                    _ => report.errors.push(format!("{} «{}»: {}", p.entity.as_str(), p.data["name"].as_str().unwrap_or(&p.id), r["message"].as_str().unwrap_or("error"))),
                }
            }
        }
        Ok(report)
    }

    /// Sube el historial pendiente (en lotes) y lo marca como subido.
    pub async fn upload_history(&self, store: &Store, local_ws: &str, remote_ws: &str) -> Result<usize> {
        let mut total = 0;
        loop {
            let pending = store.pending_history(local_ws, 200)?;
            if pending.is_empty() {
                return Ok(total);
            }
            let entries: Vec<Value> = pending
                .iter()
                .map(|h| json!({ "itemId": h.item_id, "method": h.method, "url": h.url, "status": h.status, "time": h.time_ms, "request": h.request, "createdAt": h.created_at }))
                .collect();
            self.call("POST", &format!("/api/workspaces/{remote_ws}/history"), Some(json!({ "entries": entries }))).await?;
            store.mark_history_uploaded(&pending.iter().map(|h| h.id.clone()).collect::<Vec<_>>())?;
            total += pending.len();
        }
    }

    /// Sube las ejecuciones del runner con el formato de resultados del servidor.
    pub async fn upload_runs(&self, store: &Store, local_ws: &str, remote_ws: &str) -> Result<usize> {
        let runs = store.pending_runs(local_ws)?;
        for r in &runs {
            let s = &r.summary;
            let results = s["results"].as_array().cloned().unwrap_or_default();
            let executions: Vec<Value> = results
                .iter()
                .map(|x| {
                    let tests: Vec<Value> = x["tests"].as_array().cloned().unwrap_or_default();
                    let mut e = json!({
                        "id": format!("{}-{}", x["item_id"].as_str().unwrap_or_default(), x["iteration"]),
                        "itemId": x["item_id"], "name": x["name"], "iteration": x["iteration"],
                        "request": { "method": x["method"], "url": x["url"], "headers": [] },
                        "tests": tests,
                    });
                    if let Some(code) = x["status"].as_u64() {
                        e["response"] = json!({
                            "code": code, "status": x["reason"], "headers": [], "cookies": [],
                            "size": { "body": x["size"], "header": 0, "total": x["size"] }, "time": x["time_ms"],
                        });
                    }
                    if let Some(err) = x["error"].as_str() {
                        e["error"] = json!(err);
                    }
                    e
                })
                .collect();
            let failed_requests = results.iter().filter(|x| !x["error"].is_null()).count();
            let assertions: usize = results.iter().map(|x| x["tests"].as_array().map(|t| t.len()).unwrap_or(0)).sum();
            let started = s["started_at"].as_str().unwrap_or(&r.created_at).to_string();
            let result = json!({
                "executions": executions,
                "console": [],
                "stats": {
                    "requests": s["requests"], "failedRequests": failed_requests,
                    "assertions": assertions, "failedAssertions": s["tests_failed"],
                    "iterations": s["iterations"], "totalTime": s["duration_ms"],
                },
                "environment": [], "globals": [], "collectionVariables": [],
                "startedAt": started, "finishedAt": r.created_at,
            });
            let name = s["collection"].as_str().unwrap_or("Ejecución").to_string();
            self.call(
                "POST",
                &format!("/api/workspaces/{remote_ws}/runs/report"),
                Some(json!({ "name": name, "collectionId": r.collection_id, "source": "desktop", "result": result })),
            )
            .await?;
            store.mark_run_uploaded(&r.id)?;
        }
        Ok(runs.len())
    }

    /// Una vuelta completa: bajar, subir, volver a bajar lo nuestro y subir historial y ejecuciones.
    pub async fn sync(&self, store: &Store, local_ws: &str, remote_ws: &str) -> Result<Report> {
        let cursor = store.workspace(local_ws)?.cursor;
        let (next, pulled) = self.pull(store, local_ws, remote_ws, cursor.as_deref()).await?;
        store.set_cursor(local_ws, Some(&next))?;
        let mut report = self.push(store, local_ws, remote_ws).await?;
        report.pulled = pulled;
        if let Err(e) = self.upload_history(store, local_ws, remote_ws).await {
            report.errors.push(format!("historial: {e}"));
        }
        if let Err(e) = self.upload_runs(store, local_ws, remote_ws).await {
            report.errors.push(format!("ejecuciones: {e}"));
        }
        Ok(report)
    }
}
