//! Contratos entre frontend y backend. La lógica es la misma que en la web, el servidor y el
//! MCP: vive en `packages/contracts` y aquí se ejecuta con el motor de QuickJS
//! (`cartero_script::engine`). Este módulo solo traduce entre Rust y ese motor.

use cartero_model::prepare::{Prepared, PreparedBody};
use cartero_model::{Collection, Item};
use cartero_script::engine;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::i18n;

#[derive(Debug, Clone, Deserialize)]
pub struct Issue {
    pub level: String,
    /// Dónde: status, body, header, query o path (de momento no se muestra)
    #[serde(rename = "where")]
    #[allow(dead_code)]
    pub place: String,
    pub path: String,
    pub message: String,
    #[serde(default)]
    pub params: Vec<Value>,
}

impl Issue {
    pub fn is_error(&self) -> bool {
        self.level == "error"
    }
    /// Motivo en el idioma de la interfaz («Es obligatorio y no ha llegado»).
    pub fn text(&self) -> String {
        template(&self.message, &self.params)
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Check {
    pub request: Vec<Issue>,
    pub response: Vec<Issue>,
    pub errors: usize,
    pub warnings: usize,
}

impl Check {
    pub fn is_clean(&self) -> bool {
        self.request.is_empty() && self.response.is_empty()
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct Change {
    pub breaking: bool,
    pub section: String,
    pub path: String,
    #[serde(default)]
    pub param: Option<String>,
    pub message: String,
    #[serde(default)]
    pub params: Vec<Value>,
}

impl Change {
    /// «Respuesta 200 · $.email: Se quita el campo», traducido.
    pub fn text(&self) -> String {
        let section = if self.section == "request" {
            i18n::tr("Petición").to_string()
        } else {
            i18n::trf("Respuesta {code}", &[("code", &self.section)]).to_string()
        };
        let param = match self.param.as_deref() {
            Some("path") => format!("{} ", i18n::tr("Parámetro de ruta")),
            Some("query") => format!("{} ", i18n::tr("Query")),
            Some("header") => format!("{} ", i18n::tr("Cabecera")),
            _ => String::new(),
        };
        let path = if self.path == self.section { String::new() } else { format!(" · {param}{}", self.path) };
        format!("{section}{path}: {}", template(&self.message, &self.params))
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Diff {
    pub changes: Vec<Change>,
    pub summary: String,
}

impl Diff {
    pub fn breaking(&self) -> Vec<&Change> {
        self.changes.iter().filter(|c| c.breaking).collect()
    }
    /// Resumen traducido: «1 cambio que rompe, 2 compatibles».
    pub fn summary_text(&self) -> String {
        summary_text(&self.summary)
    }
}

/// Traduce una plantilla del motor («Se esperaba {0} y ha llegado {1}») y sustituye sus valores.
pub fn template(message: &str, params: &[Value]) -> String {
    let mut s = i18n::tr_dyn(message);
    for (i, p) in params.iter().enumerate() {
        let v = match p {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        };
        s = s.replace(&format!("{{{i}}}"), &v);
    }
    s
}

/// Resumen del motor («1 cambio que rompe, 2 compatibles», «sin cambios de estructura») traducido.
pub fn summary_text(summary: &str) -> String {
    if summary == "sin cambios de estructura" {
        return i18n::tr("sin cambios de estructura").to_string();
    }
    summary
        .split(", ")
        .map(|part| {
            let (n, rest) = part.split_once(' ').unwrap_or((part, ""));
            match (n, rest) {
                ("1", "cambio que rompe") => i18n::tr("1 cambio que rompe").to_string(),
                (n, "cambios que rompen") => i18n::trf("{n} cambios que rompen", &[("n", n)]).to_string(),
                ("1", "compatible") => i18n::tr("1 compatible").to_string(),
                (n, "compatibles") => i18n::trf("{n} compatibles", &[("n", n)]).to_string(),
                _ => part.to_string(),
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

/// Contrato de una petición, si tiene alguno con contenido.
pub fn of_item(item: &Item) -> Option<Value> {
    item.extra.get("contract").filter(|c| has_contract(c)).cloned()
}

/// Igual que `hasContract` del paquete: alguna respuesta o algo en la parte de petición.
pub fn has_contract(c: &Value) -> bool {
    let non_empty = |v: Option<&Value>| match v {
        Some(Value::Array(a)) => !a.is_empty(),
        Some(Value::Object(o)) => !o.is_empty(),
        Some(Value::Null) | None => false,
        Some(_) => true,
    };
    let r = c.get("request");
    non_empty(c.get("responses"))
        || r.is_some_and(|r| {
            r.get("body").is_some_and(|b| !b.is_null())
                || non_empty(r.get("query"))
                || non_empty(r.get("headers"))
                || non_empty(r.get("path"))
        })
}

fn kv(list: &[(String, String)]) -> Value {
    Value::Array(list.iter().map(|(k, v)| json!({ "key": k, "value": v })).collect())
}

/// Comprueba lo enviado y lo recibido contra el contrato. `None` si el motor falla.
pub fn check(contract: &Value, template_url: &str, sent: &Prepared, res: Option<&cartero_http::Response>) -> Option<Check> {
    let body = match &sent.body {
        PreparedBody::Raw(s) => Value::String(s.clone()),
        _ => Value::Null,
    };
    let sent = json!({ "url": sent.url, "headers": kv(&sent.headers), "body": body });
    let res = res.map(|r| json!({ "code": r.status, "headers": kv(&r.headers), "body": r.text() })).unwrap_or(Value::Null);
    let out = engine::call("check", &[contract.clone(), json!(template_url), sent, res]).ok()?;
    serde_json::from_value(out).ok()
}

/// Cambios entre dos versiones del contrato.
pub fn diff(before: Option<&Value>, after: Option<&Value>) -> Diff {
    let out = engine::call("diff", &[before.cloned().unwrap_or(Value::Null), after.cloned().unwrap_or(Value::Null)]);
    out.ok().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
}

/// Esquema deducido de un cuerpo JSON (None si no es JSON).
pub fn infer(text: &str) -> Option<Value> {
    engine::call("infer", &[json!(text)]).ok().filter(|v| !v.is_null())
}

/// Parte de petición sacada de la petición actual (ruta, query, cabeceras y cuerpo).
pub fn request_part(item: &Item) -> Value {
    let request = serde_json::to_value(item.request.clone().unwrap_or_default()).unwrap_or(Value::Null);
    engine::call("requestContract", &[request]).unwrap_or_else(|_| json!({}))
}

/// La colección como OpenAPI 3.1 (YAML o JSON) y los avisos de la conversión.
pub fn to_openapi(collection: &Collection, yaml: bool) -> Result<(String, Vec<String>), String> {
    let c = serde_json::to_value(cartero_model::export::collection(collection)).map_err(|e| e.to_string())?;
    let out = engine::call("toOpenApi", &[c, json!(if yaml { "yaml" } else { "json" })]).map_err(|e| e.to_string())?;
    let text = out["text"].as_str().unwrap_or_default().to_string();
    Ok((text, warnings(&out)))
}

/// ¿El texto es una especificación OpenAPI o Swagger?
pub fn is_openapi(text: &str) -> bool {
    let t = text.trim_start();
    // Atajo: solo se pregunta al motor si parece una spec
    (t.contains("openapi") || t.contains("swagger")) && engine::call("isOpenApi", &[json!(text)]).ok() == Some(Value::Bool(true))
}

/// Importa una especificación OpenAPI 3.x como colección, con los contratos de sus peticiones.
pub fn from_openapi(text: &str) -> Result<(Collection, Vec<String>), String> {
    let out = engine::call("fromOpenApi", &[json!(text)]).map_err(|e| e.to_string())?;
    let collection: Collection = serde_json::from_value(out["collection"].clone()).map_err(|e| e.to_string())?;
    Ok((collection, warnings(&out)))
}

fn warnings(out: &Value) -> Vec<String> {
    out["warnings"].as_array().map(|a| a.iter().filter_map(|w| w.as_str().map(i18n::tr_dyn)).collect()).unwrap_or_default()
}

/// Plantillas de mensajes que devuelve el motor: tienen que estar en `en.json`.
#[cfg(test)]
pub const ENGINE_MESSAGES: &[&str] = &[
    "Es obligatorio y no ha llegado",
    "Se esperaba {0} y ha llegado {1}",
    "Solo admite estos valores: {0}",
    "Debe valer {0}",
    "No tiene formato {0}",
    "El contrato no permite este campo",
    "No cumple la regla {0}",
    "No está en el contrato",
    "El esquema del contrato no es válido y no se ha podido comprobar",
    "Este código no está en el contrato (previstos: {0})",
    "El contrato no define ninguna respuesta",
    "La respuesta no es JSON y el contrato espera un JSON",
    "La respuesta llega vacía y el contrato espera un cuerpo",
    "Falta la cabecera obligatoria",
    "Falta el parámetro obligatorio",
    "El cuerpo no es JSON y el contrato espera un JSON",
    "Falta el cuerpo que pide el contrato",
    "Se define la estructura",
    "Se quita la estructura",
    "Cambia el tipo: {0} → {1}",
    "Se limitan los valores permitidos",
    "Ya no se limitan los valores",
    "Nuevos valores posibles: {0}",
    "Se quitan valores: {0}",
    "Cambia el formato: {0} → {1}",
    "Se quita el campo",
    "Deja de ser obligatorio",
    "Pasa a ser obligatorio",
    "Nuevo campo obligatorio",
    "Nuevo campo opcional",
    "Se quita",
    "Nuevo y obligatorio",
    "Nuevo y opcional",
    "Se quita este código de respuesta",
    "Nuevo código de respuesta",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn los_mensajes_del_motor_tienen_traduccion() {
        let en: std::collections::HashMap<String, String> = serde_json::from_str(include_str!("i18n/en.json")).unwrap();
        let missing: Vec<_> = ENGINE_MESSAGES.iter().filter(|m| !en.contains_key(**m)).collect();
        assert!(missing.is_empty(), "Faltan en en.json: {missing:?}");
    }

    #[test]
    fn plantillas_y_resumenes() {
        assert_eq!(
            template("Se esperaba {0} y ha llegado {1}", &[json!("integer"), json!("string")]),
            "Se esperaba integer y ha llegado string"
        );
        assert_eq!(summary_text("2 cambios que rompen, 1 compatible"), "2 cambios que rompen, 1 compatible");
        // En inglés (sin tocar el idioma global, que comparten los tests en paralelo)
        assert_eq!(i18n::translate("Se esperaba {0} y ha llegado {1}", true), "Expected {0}, got {1}");
        assert_eq!(i18n::translate("{n} cambios que rompen", true), "{n} breaking changes");
    }

    #[test]
    fn openapi_ida_y_vuelta_con_el_modelo_de_la_app() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../packages/importers/fixtures/openapi.yaml");
        let text = std::fs::read_to_string(path).unwrap();
        assert!(is_openapi(&text));
        assert!(!is_openapi("{\"info\":{\"name\":\"x\"},\"item\":[]}"));
        let (collection, warnings) = from_openapi(&text).unwrap();
        assert_eq!(collection.info.name, "Petstore");
        assert!(warnings.iter().any(|w| w.contains("contrato")), "{warnings:?}");
        let pets = &collection.item[0];
        let get = pets.children().iter().find(|i| i.name == "Get pet").unwrap();
        assert_eq!(get.request.as_ref().unwrap().url.raw(), "{{baseUrl}}/pets/:petId");
        assert!(of_item(get).is_some());

        let (yaml, _) = to_openapi(&collection, true).unwrap();
        assert!(yaml.starts_with("openapi: 3.1.0"));
        let (json, _) = to_openapi(&collection, false).unwrap();
        let spec: Value = serde_json::from_str(&json).unwrap();
        assert!(spec["paths"]["/pets/{petId}"]["get"].is_object());
        let (back, _) = from_openapi(&yaml).unwrap();
        assert_eq!(back.item[0].children().len(), 3);
    }

    #[test]
    fn comprueba_lo_enviado_y_lo_recibido() {
        let contract = json!({ "request": { "query": [{ "name": "page", "required": true }] }, "responses": { "200": { "body": { "type": "object", "properties": { "id": { "type": "integer" } }, "required": ["id"] } } } });
        let sent = Prepared {
            method: "GET".into(),
            url: "http://localhost:3000/users".into(),
            headers: vec![],
            body: PreparedBody::None,
            auth: None,
        };
        let c = check(&contract, "{{baseUrl}}/users", &sent, None).unwrap();
        assert_eq!(c.request[0].path, "page");
        assert_eq!(c.request[0].text(), "Falta el parámetro obligatorio");
        assert_eq!(c.errors, 1);
    }

    #[test]
    fn cambios_traducidos() {
        let before = json!({ "responses": { "200": { "body": { "type": "object", "properties": { "email": { "type": "string" } }, "required": ["email"] } } } });
        let after = json!({ "responses": { "200": { "body": { "type": "object", "properties": {}, "required": [] } } } });
        let d = diff(Some(&before), Some(&after));
        assert_eq!(d.breaking().len(), 1);
        assert_eq!(d.changes[0].text(), "Respuesta 200 · $.email: Se quita el campo");
    }
}
