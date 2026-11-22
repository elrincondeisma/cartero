//! Importación: detecta el formato y lo convierte al modelo de Cartero.

pub mod curl;
pub mod postman;

use serde_json::Value;

use crate::types::{Collection, Environment, Variable};

#[derive(Debug, Default)]
pub struct ImportResult {
    pub collections: Vec<Collection>,
    pub environments: Vec<Environment>,
    pub globals: Option<Vec<Variable>>,
    pub warnings: Vec<String>,
    pub format: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    #[error("No se pudo leer el contenido: no es JSON ni un comando cURL")]
    Unreadable,
    #[error("Formato no reconocido")]
    Unknown,
    #[error("{0}")]
    Invalid(String),
}

/// Detecta el formato (colección de Postman v1/v2.0/v2.1, entorno, globales, volcado de datos,
/// exportación de Cartero o cURL) e importa.
pub fn import_any(text: &str) -> Result<ImportResult, ImportError> {
    let text = text.trim_start_matches('\u{feff}').trim();
    if curl::is_curl(text) {
        return Ok(ImportResult { collections: vec![curl::import(text)?], format: "curl".into(), ..Default::default() });
    }
    let json: Value = serde_json::from_str(text).map_err(|_| ImportError::Unreadable)?;
    import_json(json)
}

pub fn import_json(json: Value) -> Result<ImportResult, ImportError> {
    use postman::*;
    let mut r = ImportResult::default();
    let multi = (json.get("cartero").and_then(Value::as_i64) == Some(1) || is_dump(&json)) && json["collections"].is_array();
    if multi {
        r.format = if json.get("cartero").is_some() { "cartero-workspace" } else { "postman-dump" }.into();
        for c in json["collections"].as_array().into_iter().flatten() {
            match import_collection(c.clone()) {
                Ok(c) => r.collections.push(c),
                Err(e) => r.warnings.push(e.to_string()),
            }
        }
        for e in json["environments"].as_array().into_iter().flatten() {
            r.environments.push(import_environment(e));
        }
        if let Some(g) = json["globals"].as_array().filter(|g| !g.is_empty()) {
            r.globals = Some(normalize_variables(g));
        }
        return Ok(r);
    }
    if is_collection(&json) {
        r.format = "postman-collection".into();
        r.collections.push(import_collection(json)?);
    } else if is_globals(&json) {
        r.format = "postman-globals".into();
        r.globals = Some(normalize_variables(json["values"].as_array().unwrap()));
    } else if is_environment(&json) {
        r.format = "postman-environment".into();
        r.environments.push(import_environment(&json));
    } else {
        return Err(ImportError::Unknown);
    }
    Ok(r)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tree::find;

    pub fn fixture(name: &str) -> String {
        let path = format!("{}/../../../packages/importers/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
        std::fs::read_to_string(path).unwrap()
    }

    #[test]
    fn postman_v21_conservando_todo() {
        let original: Value = serde_json::from_str(&fixture("postman-v21.json")).unwrap();
        let r = import_any(&fixture("postman-v21.json")).unwrap();
        assert_eq!(r.format, "postman-collection");
        let c = &r.collections[0];
        assert_eq!(c.info.name, "Demo API");
        assert_eq!(serde_json::to_value(&c.auth).unwrap(), original["auth"]);
        let users = &c.item[0];
        assert!(users.is_folder());
        let list = &users.children()[0];
        assert_eq!(list.response.as_ref().unwrap()[0].body.as_deref(), Some("[{\"id\":1}]"));
        assert!(list.id.is_some());
        assert_eq!(users.children()[1].request.as_ref().unwrap().auth().unwrap().kind, "basic");
        assert!(find(&c.item, list.id()).is_some());
    }

    #[test]
    fn postman_v20_a_v21() {
        let r = import_any(&fixture("postman-v20.json")).unwrap();
        let c = &r.collections[0];
        assert!(c.info.schema.as_deref().unwrap().contains("v2.1.0"));
        let auth = c.item[0].request.as_ref().unwrap().auth().unwrap();
        assert_eq!(auth.kind, "basic");
        assert!(auth.params["basic"].is_array());
        assert_eq!(auth.get("username").as_deref(), Some("u"));
    }

    #[test]
    fn postman_v1_con_carpetas() {
        let r = import_any(&fixture("postman-v1.json")).unwrap();
        let c = &r.collections[0];
        assert_eq!(c.info.name, "Legacy v1");
        let names: Vec<_> = c.item.iter().map(|i| i.name.as_str()).collect();
        assert!(names.contains(&"Carpeta") && names.contains(&"Root req"));
        let folder = c.item.iter().find(|i| i.name == "Carpeta").unwrap();
        assert_eq!(folder.children()[0].request.as_ref().unwrap().method, "DELETE");
        let root = c.item.iter().find(|i| i.name == "Root req").unwrap();
        assert_eq!(root.request.as_ref().unwrap().headers()[0].key, "Accept");
    }

    #[test]
    fn entornos_y_globales() {
        let r = import_any(&fixture("postman-env.json")).unwrap();
        let e = &r.environments[0];
        assert_eq!(e.name, "Producción");
        assert_eq!(e.values.len(), 3);
        assert_eq!(e.values[1].kind.as_deref(), Some("secret"));
        assert!(e.values[2].disabled);
        assert!(e.values[0].kind.is_none());
        let g = import_any(&fixture("postman-globals.json")).unwrap();
        assert_eq!(g.globals.unwrap()[0].key, "g1");
    }

    #[test]
    fn rechaza_basura() {
        assert!(matches!(import_any("hola que tal"), Err(ImportError::Unreadable)));
        assert!(matches!(import_any("{\"foo\":1}"), Err(ImportError::Unknown)));
    }
}
