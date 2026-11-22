//! Tipos del formato Postman Collection v2.1.
//!
//! Cada estructura guarda en `extra` los campos que no conoce, y los campos opcionales solo se
//! escriben si venían: importar y exportar una colección devuelve el mismo JSON.

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};

pub const POSTMAN_SCHEMA_V21: &str = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

pub type Extra = Map<String, Value>;

fn is_false(b: &bool) -> bool {
    !*b
}

/// Acepta cadenas, números, booleanos o null y los guarda como texto (Postman a veces exporta
/// `"value": 1` en cabeceras o variables).
fn lenient_string<'de, D: Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    Ok(match Value::deserialize(d)? {
        Value::String(s) => s,
        Value::Null => String::new(),
        other => other.to_string(),
    })
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct KeyValue {
    #[serde(default, deserialize_with = "lenient_string")]
    pub key: String,
    #[serde(default, deserialize_with = "lenient_string")]
    pub value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<Value>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub disabled: bool,
    #[serde(default, rename = "type", skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(flatten)]
    pub extra: Extra,
}

impl KeyValue {
    pub fn new(key: impl Into<String>, value: impl Into<String>) -> Self {
        Self { key: key.into(), value: value.into(), ..Default::default() }
    }
}

/// Variable de colección, entorno o globales. El valor se guarda tal cual (puede ser número).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Variable {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, deserialize_with = "lenient_string")]
    pub key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<Value>,
    #[serde(default, rename = "type", skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<Value>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub disabled: bool,
    #[serde(flatten)]
    pub extra: Extra,
}

impl Variable {
    pub fn new(key: impl Into<String>, value: impl Into<String>) -> Self {
        Self { key: key.into(), value: Some(Value::String(value.into())), ..Default::default() }
    }
    pub fn value_str(&self) -> String {
        match &self.value {
            None | Some(Value::Null) => String::new(),
            Some(Value::String(s)) => s.clone(),
            Some(v) => v.to_string(),
        }
    }
    pub fn is_secret(&self) -> bool {
        self.kind.as_deref() == Some("secret")
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct QueryParam {
    pub key: Option<String>,
    pub value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<Value>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub disabled: bool,
    #[serde(flatten)]
    pub extra: Extra,
}

/// URL estructurada de Postman. `raw` es lo que escribe el usuario; el resto se deriva.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct UrlParts {
    #[serde(default)]
    pub raw: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protocol: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "host_or_path")]
    pub host: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "host_or_path")]
    pub path: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query: Option<Vec<QueryParam>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variable: Option<Vec<Variable>>,
    #[serde(flatten)]
    pub extra: Extra,
}

/// En v2.0 `host` y `path` pueden ser una cadena en vez de una lista.
fn host_or_path<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Vec<String>>, D::Error> {
    Ok(match Option::<Value>::deserialize(d)? {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => Some(vec![s]),
        Some(Value::Array(a)) => Some(
            a.into_iter()
                .map(|v| match v {
                    Value::String(s) => s,
                    // segmentos de ruta como objeto { type, value }
                    Value::Object(o) => o.get("value").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                    other => other.to_string(),
                })
                .collect(),
        ),
        Some(_) => None,
    })
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
#[allow(clippy::large_enum_variant)]
pub enum Url {
    Raw(String),
    Parts(UrlParts),
}

impl Default for Url {
    fn default() -> Self {
        Url::Raw(String::new())
    }
}

impl Url {
    /// La URL tal y como la ve el usuario.
    pub fn raw(&self) -> String {
        match self {
            Url::Raw(s) => s.clone(),
            Url::Parts(p) if !p.raw.is_empty() => p.raw.clone(),
            Url::Parts(p) => crate::url::to_string(p),
        }
    }
    pub fn path_variables(&self) -> &[Variable] {
        match self {
            Url::Parts(UrlParts { variable: Some(v), .. }) => v,
            _ => &[],
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct FormParam {
    #[serde(default, deserialize_with = "lenient_string")]
    pub key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub src: Option<Value>,
    #[serde(default, rename = "type", skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, rename = "contentType", skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<Value>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub disabled: bool,
    #[serde(flatten)]
    pub extra: Extra,
}

impl FormParam {
    pub fn is_file(&self) -> bool {
        self.kind.as_deref() == Some("file")
    }
    /// Rutas de los ficheros (src puede ser una cadena o una lista)
    pub fn files(&self) -> Vec<String> {
        match &self.src {
            Some(Value::String(s)) if !s.is_empty() => vec![s.clone()],
            Some(Value::Array(a)) => a.iter().filter_map(|v| v.as_str().map(String::from)).collect(),
            _ => vec![],
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Body {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub urlencoded: Option<Vec<KeyValue>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formdata: Option<Vec<FormParam>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub graphql: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Value>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub disabled: bool,
    #[serde(flatten)]
    pub extra: Extra,
}

impl Body {
    pub fn mode(&self) -> &str {
        self.mode.as_deref().unwrap_or("none")
    }
    /// Lenguaje del cuerpo raw: json, xml, text, html, javascript
    pub fn raw_language(&self) -> &str {
        self.options.as_ref().and_then(|o| o.pointer("/raw/language")).and_then(|v| v.as_str()).unwrap_or("text")
    }
    pub fn set_raw_language(&mut self, lang: &str) {
        let opts = self.options.get_or_insert_with(|| Value::Object(Map::new()));
        if !opts.is_object() {
            *opts = Value::Object(Map::new());
        }
        let raw = opts.as_object_mut().unwrap().entry("raw").or_insert_with(|| Value::Object(Map::new()));
        if !raw.is_object() {
            *raw = Value::Object(Map::new());
        }
        raw.as_object_mut().unwrap().insert("language".into(), Value::String(lang.into()));
    }
    pub fn file_src(&self) -> Option<String> {
        self.file.as_ref().and_then(|f| f.get("src")).and_then(|s| s.as_str()).map(String::from)
    }
}

/// Autenticación: `{ "type": "bearer", "bearer": [{ key, value, type }] }`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Auth {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(flatten)]
    pub params: Map<String, Value>,
}

impl Auth {
    pub fn new(kind: &str) -> Self {
        Self { kind: kind.into(), params: Map::new() }
    }
    pub fn is_inherit(&self) -> bool {
        self.kind == "inherit"
    }
    pub fn is_none(&self) -> bool {
        self.kind == "noauth"
    }
    /// Atributo del esquema activo como texto. Acepta la forma v2.1 (lista) y la v2.0 (objeto).
    pub fn get(&self, key: &str) -> Option<String> {
        let scheme = self.params.get(&self.kind)?;
        let v = match scheme {
            Value::Array(list) => list.iter().find(|a| a.get("key").and_then(|k| k.as_str()) == Some(key))?.get("value")?,
            Value::Object(o) => o.get(key)?,
            _ => return None,
        };
        Some(match v {
            Value::String(s) => s.clone(),
            Value::Null => String::new(),
            other => other.to_string(),
        })
    }
    pub fn get_or(&self, key: &str, default: &str) -> String {
        self.get(key).filter(|s| !s.is_empty()).unwrap_or_else(|| default.to_string())
    }
    pub fn set(&mut self, key: &str, value: impl Into<String>) {
        let kind = self.kind.clone();
        let scheme = self.params.entry(kind).or_insert_with(|| Value::Array(vec![]));
        if !scheme.is_array() {
            *scheme = Value::Array(vec![]);
        }
        let list = scheme.as_array_mut().unwrap();
        let value = Value::String(value.into());
        if let Some(a) = list.iter_mut().find(|a| a.get("key").and_then(|k| k.as_str()) == Some(key)) {
            a["value"] = value;
        } else {
            list.push(serde_json::json!({ "key": key, "value": value, "type": "string" }));
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Script {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, rename = "type", skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exec: Option<Value>,
    #[serde(flatten)]
    pub extra: Extra,
}

impl Script {
    /// El código como un único texto (Postman lo guarda como lista de líneas).
    pub fn source(&self) -> String {
        match &self.exec {
            Some(Value::Array(lines)) => lines.iter().map(|l| l.as_str().unwrap_or_default()).collect::<Vec<_>>().join("\n"),
            Some(Value::String(s)) => s.clone(),
            _ => String::new(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Event {
    pub listen: String,
    #[serde(default)]
    pub script: Script,
    #[serde(default, skip_serializing_if = "is_false")]
    pub disabled: bool,
    #[serde(flatten)]
    pub extra: Extra,
}

impl Event {
    pub fn new(listen: &str, source: &str) -> Self {
        let lines = source.split('\n').map(|l| Value::String(l.into())).collect();
        Self {
            listen: listen.into(),
            script: Script { kind: Some("text/javascript".into()), exec: Some(Value::Array(lines)), ..Default::default() },
            ..Default::default()
        }
    }
}

/// Script de un evento (`prerequest` o `test`), si existe y está activo.
pub fn script_of(events: &Option<Vec<Event>>, listen: &str) -> Option<String> {
    events.as_ref()?.iter().find(|e| e.listen == listen && !e.disabled).map(|e| e.script.source()).filter(|s| !s.trim().is_empty())
}

/// Cambia el script de un evento; si queda vacío, lo quita.
pub fn set_script(events: &mut Option<Vec<Event>>, listen: &str, source: &str) {
    let list = events.get_or_insert_with(Vec::new);
    let lines: Vec<Value> = source.split('\n').map(|l| Value::String(l.into())).collect();
    match list.iter_mut().find(|e| e.listen == listen) {
        Some(_) if source.trim().is_empty() => list.retain(|e| e.listen != listen),
        Some(e) => e.script.exec = Some(Value::Array(lines)),
        None if source.trim().is_empty() => {}
        None => list.push(Event::new(listen, source)),
    }
    if list.is_empty() {
        *events = None;
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Request {
    #[serde(default = "default_method")]
    pub method: String,
    #[serde(default)]
    pub url: Url,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "headers")]
    pub header: Option<Vec<KeyValue>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<Body>,
    /// `None`: no viene (hereda). `Some(None)`: `null` explícito.
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "auth_field")]
    pub auth: Option<Option<Auth>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<Value>,
    #[serde(flatten)]
    pub extra: Extra,
}

fn default_method() -> String {
    "GET".into()
}

/// Las cabeceras pueden venir como texto ("A: 1\nB: 2") en exportaciones antiguas.
fn headers<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Vec<KeyValue>>, D::Error> {
    Ok(match Option::<Value>::deserialize(d)? {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => {
            Some(s.lines().filter_map(|l| l.split_once(':')).map(|(k, v)| KeyValue::new(k.trim(), v.trim())).collect())
        }
        Some(v) => Some(serde_json::from_value(v).map_err(serde::de::Error::custom)?),
    })
}

fn auth_field<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Option<Auth>>, D::Error> {
    Ok(Some(Option::<Auth>::deserialize(d)?))
}

impl Request {
    pub fn new(method: &str, url: &str) -> Self {
        Self { method: method.into(), url: Url::Parts(crate::url::parse(url)), ..Default::default() }
    }
    pub fn headers(&self) -> &[KeyValue] {
        self.header.as_deref().unwrap_or_default()
    }
    pub fn auth(&self) -> Option<&Auth> {
        self.auth.as_ref().and_then(|a| a.as_ref())
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ResponseExample {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "originalRequest", skip_serializing_if = "Option::is_none")]
    pub original_request: Option<Request>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cookie: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(flatten)]
    pub extra: Extra,
}

/// Carpeta o petición. Las carpetas tienen `item`; las peticiones, `request`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Item {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default)]
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item: Option<Vec<Item>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request: Option<Request>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response: Option<Vec<ResponseExample>>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "auth_field")]
    pub auth: Option<Option<Auth>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event: Option<Vec<Event>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variable: Option<Vec<Variable>>,
    #[serde(flatten)]
    pub extra: Extra,
}

impl Item {
    pub fn folder(name: &str) -> Self {
        Self { id: Some(crate::new_id()), name: name.into(), item: Some(vec![]), ..Default::default() }
    }
    pub fn request(name: &str, request: Request) -> Self {
        Self { id: Some(crate::new_id()), name: name.into(), request: Some(request), ..Default::default() }
    }
    pub fn is_folder(&self) -> bool {
        self.item.is_some() || self.request.is_none()
    }
    pub fn children(&self) -> &[Item] {
        self.item.as_deref().unwrap_or_default()
    }
    pub fn id(&self) -> &str {
        self.id.as_deref().unwrap_or_default()
    }
    /// Auth propia (carpeta o petición), si la hay y no es «heredar».
    pub fn own_auth(&self) -> Option<&Auth> {
        let auth = if self.is_folder() { self.auth.as_ref() } else { self.request.as_ref().and_then(|r| r.auth.as_ref()) };
        auth.and_then(|a| a.as_ref()).filter(|a| !a.is_inherit())
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Info {
    #[serde(default, rename = "_postman_id", skip_serializing_if = "Option::is_none")]
    pub postman_id: Option<String>,
    #[serde(default)]
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Collection {
    pub info: Info,
    #[serde(default)]
    pub item: Vec<Item>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "auth_field")]
    pub auth: Option<Option<Auth>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event: Option<Vec<Event>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variable: Option<Vec<Variable>>,
    #[serde(flatten)]
    pub extra: Extra,
}

impl Collection {
    pub fn new(name: &str) -> Self {
        Self {
            info: Info {
                postman_id: Some(crate::new_id()),
                name: name.into(),
                schema: Some(POSTMAN_SCHEMA_V21.into()),
                ..Default::default()
            },
            ..Default::default()
        }
    }
    pub fn auth(&self) -> Option<&Auth> {
        self.auth.as_ref().and_then(|a| a.as_ref())
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Environment {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub values: Vec<Variable>,
}

/// Texto de una descripción (cadena o `{ content, type }`).
pub fn description_text(d: &Option<Value>) -> String {
    match d {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Object(o)) => o.get("content").and_then(|c| c.as_str()).unwrap_or_default().to_string(),
        _ => String::new(),
    }
}
