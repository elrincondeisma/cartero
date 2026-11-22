//! Colecciones de Postman (v1, v2.0 y v2.1), entornos y globales.

use serde_json::{Map, Value, json};

use super::ImportError;
use crate::types::{Collection, Environment, POSTMAN_SCHEMA_V21, Variable};

pub fn is_collection(j: &Value) -> bool {
    if j.get("info").is_some() && j["item"].is_array() {
        return true;
    }
    j["requests"].is_array() && (j["order"].is_array() || j["folders"].is_array())
}

pub fn is_environment(j: &Value) -> bool {
    j["values"].is_array() && j["_postman_variable_scope"] != "globals" && j.get("info").is_none()
}

pub fn is_globals(j: &Value) -> bool {
    j["values"].is_array() && j["_postman_variable_scope"] == "globals"
}

pub fn is_dump(j: &Value) -> bool {
    j["version"] == 1 && j["collections"].is_array()
}

/// Normaliza cualquier versión de colección de Postman a v2.1.
pub fn import_collection(mut j: Value) -> Result<Collection, ImportError> {
    if j.get("info").is_none() {
        j = v1_to_v21(&j);
    } else if j["info"]["schema"].as_str().unwrap_or_default().contains("v2.0.0") {
        v20_to_v21(&mut j);
    }
    let mut c: Collection = serde_json::from_value(j).map_err(|e| ImportError::Invalid(format!("Colección no válida: {e}")))?;
    c.info.schema = Some(POSTMAN_SCHEMA_V21.into());
    crate::tree::ensure_ids(&mut c);
    Ok(c)
}

/// v2.0 → v2.1: la auth pasa de objeto (`{ username: "u" }`) a lista de `{ key, value, type }`,
/// y `request` puede ser solo una URL.
fn v20_to_v21(j: &mut Value) {
    fn auth(a: &mut Value) {
        let Some(obj) = a.as_object_mut() else { return };
        let kind = obj.get("type").and_then(Value::as_str).unwrap_or_default().to_string();
        for (k, v) in obj.iter_mut() {
            if k == "type" {
                continue;
            }
            if let Value::Object(params) = v {
                let list: Vec<Value> = params.iter().map(|(key, value)| json!({ "key": key, "value": value, "type": "string" })).collect();
                *v = Value::Array(list);
            }
        }
        let _ = kind;
    }
    fn items(list: &mut Value) {
        for it in list.as_array_mut().into_iter().flatten() {
            if let Some(a) = it.get_mut("auth") {
                auth(a);
            }
            if let Some(r) = it.get_mut("request") {
                if let Value::String(url) = r {
                    *r = json!({ "method": "GET", "url": url.clone() });
                }
                if let Some(a) = r.get_mut("auth") {
                    auth(a);
                }
            }
            for resp in it.get_mut("response").and_then(Value::as_array_mut).into_iter().flatten() {
                if let Some(a) = resp.get_mut("originalRequest").and_then(|o| o.get_mut("auth")) {
                    auth(a);
                }
            }
            if let Some(children) = it.get_mut("item") {
                items(children);
            }
        }
    }
    if let Some(a) = j.get_mut("auth") {
        auth(a);
    }
    if let Some(list) = j.get_mut("item") {
        items(list);
    }
}

/// v1 → v2.1: carpetas con `order` y peticiones sueltas con `folder`.
fn v1_to_v21(j: &Value) -> Value {
    let requests: Vec<&Value> = j["requests"].as_array().map(|a| a.iter().collect()).unwrap_or_default();
    let by_id = |id: &str| requests.iter().find(|r| r["id"] == id).copied();

    fn request(r: &Value) -> Value {
        let mut req = Map::new();
        req.insert("method".into(), r["method"].as_str().unwrap_or("GET").into());
        let headers: Vec<Value> = r["headers"]
            .as_str()
            .unwrap_or_default()
            .lines()
            .filter_map(|l| l.split_once(':'))
            .map(|(k, v)| {
                let k = k.trim();
                let (k, disabled) = k.strip_prefix("//").map(|k| (k.trim(), true)).unwrap_or((k, false));
                let mut h = json!({ "key": k, "value": v.trim() });
                if disabled {
                    h["disabled"] = true.into();
                }
                h
            })
            .collect();
        req.insert("header".into(), Value::Array(headers));
        match r["dataMode"].as_str() {
            Some("raw") if r["rawModeData"].is_string() => {
                req.insert("body".into(), json!({ "mode": "raw", "raw": r["rawModeData"] }));
            }
            Some(mode @ ("params" | "urlencoded")) if r["data"].as_array().is_some_and(|d| !d.is_empty()) => {
                let key = if mode == "params" { "formdata" } else { "urlencoded" };
                let data: Vec<Value> = r["data"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|d| {
                        let mut p = json!({ "key": d["key"], "value": d["value"], "type": d["type"].as_str().unwrap_or("text") });
                        if d["enabled"] == false {
                            p["disabled"] = true.into();
                        }
                        p
                    })
                    .collect();
                req.insert("body".into(), json!({ "mode": key, key: data }));
            }
            _ => {}
        }
        let raw = r["url"].as_str().unwrap_or_default();
        req.insert("url".into(), serde_json::to_value(crate::url::parse(raw)).unwrap());
        if let Some(d) = r["description"].as_str().filter(|d| !d.is_empty()) {
            req.insert("description".into(), d.into());
        }
        let mut item = json!({ "id": r["id"], "name": r["name"], "request": req });
        let mut events = vec![];
        if let Some(s) = r["preRequestScript"].as_str().filter(|s| !s.is_empty()) {
            events.push(
                json!({ "listen": "prerequest", "script": { "type": "text/javascript", "exec": s.split('\n').collect::<Vec<_>>() } }),
            );
        }
        if let Some(s) = r["tests"].as_str().filter(|s| !s.is_empty()) {
            events.push(json!({ "listen": "test", "script": { "type": "text/javascript", "exec": s.split('\n').collect::<Vec<_>>() } }));
        }
        if !events.is_empty() {
            item["event"] = Value::Array(events);
        }
        item
    }

    let folders: Vec<&Value> = j["folders"].as_array().map(|a| a.iter().collect()).unwrap_or_default();
    let ids = |v: &Value| -> Vec<String> { v.as_array().into_iter().flatten().filter_map(|s| s.as_str().map(String::from)).collect() };

    // Carpeta → sus peticiones (por order, o por el campo folder) y subcarpetas (folders_order)
    fn folder_item(f: &Value, folders: &[&Value], requests: &[&Value]) -> Value {
        let mut children = vec![];
        for sub in f["folders_order"].as_array().into_iter().flatten() {
            if let Some(sf) = folders.iter().find(|x| x["id"] == *sub) {
                children.push(folder_item(sf, folders, requests));
            }
        }
        let order: Vec<&Value> = f["order"].as_array().map(|a| a.iter().collect()).unwrap_or_default();
        if order.is_empty() {
            children.extend(requests.iter().filter(|r| r["folder"] == f["id"]).map(|r| request(r)));
        } else {
            children.extend(order.iter().filter_map(|id| requests.iter().find(|r| r["id"] == **id)).map(|r| request(r)));
        }
        json!({ "id": f["id"], "name": f["name"], "description": f["description"].as_str().unwrap_or_default(), "item": children })
    }

    let nested: Vec<String> = folders.iter().flat_map(|f| ids(&f["folders_order"])).collect();
    let mut items: Vec<Value> = vec![];
    let top: Vec<&Value> = match j["folders_order"].as_array() {
        Some(order) => order.iter().filter_map(|id| folders.iter().find(|f| f["id"] == *id).copied()).collect(),
        None => folders.iter().filter(|f| !nested.contains(&f["id"].as_str().unwrap_or_default().to_string())).copied().collect(),
    };
    for f in top {
        let mut fi = folder_item(f, &folders, &requests);
        if fi["description"] == "" {
            fi.as_object_mut().unwrap().remove("description");
        }
        items.push(fi);
    }
    for id in ids(&j["order"]) {
        if let Some(r) = by_id(&id) {
            items.push(request(r));
        }
    }
    let mut info = json!({ "_postman_id": j["id"], "name": j["name"], "schema": POSTMAN_SCHEMA_V21 });
    if let Some(d) = j["description"].as_str().filter(|d| !d.is_empty()) {
        info["description"] = d.into();
    }
    json!({ "info": info, "item": items })
}

pub fn normalize_variables(values: &[Value]) -> Vec<Variable> {
    values
        .iter()
        .filter(|v| v["key"].is_string())
        .map(|v| {
            let mut out = Variable::new(
                v["key"].as_str().unwrap(),
                match &v["value"] {
                    Value::Null => String::new(),
                    Value::String(s) => s.clone(),
                    other => other.to_string(),
                },
            );
            if let Some(t) = v["type"].as_str().filter(|t| *t != "text" && *t != "default") {
                out.kind = Some(t.into());
            }
            out.disabled = v["enabled"] == false || v["disabled"] == true;
            match &v["description"] {
                Value::String(s) if !s.is_empty() => out.description = Some(s.clone().into()),
                Value::Object(o) => out.description = o.get("content").cloned(),
                _ => {}
            }
            out
        })
        .collect()
}

pub fn import_environment(j: &Value) -> Environment {
    Environment {
        id: j["id"].as_str().map(String::from),
        name: j["name"].as_str().unwrap_or("Entorno importado").into(),
        values: normalize_variables(j["values"].as_array().map(Vec::as_slice).unwrap_or_default()),
    }
}
