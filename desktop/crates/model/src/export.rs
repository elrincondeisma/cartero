//! Exportación a Postman v2.1 (colecciones, entornos y globales) y al formato de workspace de Cartero.

use serde_json::{Value, json};

use crate::types::{Collection, Environment, POSTMAN_SCHEMA_V21, Variable};

pub fn collection(c: &Collection) -> Value {
    let mut c = c.clone();
    c.info.schema = Some(POSTMAN_SCHEMA_V21.into());
    // Orden de claves igual que Postman: info, item, auth, event, variable (lo da el struct)
    serde_json::to_value(c).unwrap_or(Value::Null)
}

fn vars(values: &[Variable]) -> Vec<Value> {
    values
        .iter()
        .map(|v| json!({ "key": v.key, "value": v.value_str(), "type": v.kind.as_deref().unwrap_or("default"), "enabled": !v.disabled }))
        .collect()
}

pub fn environment(e: &Environment) -> Value {
    let mut out = json!({
        "name": e.name,
        "values": vars(&e.values),
        "_postman_variable_scope": "environment",
        "_postman_exported_at": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "_postman_exported_using": "Cartero",
    });
    if let Some(id) = &e.id {
        out["id"] = id.clone().into();
    }
    out
}

pub fn globals(values: &[Variable]) -> Value {
    json!({
        "name": "Globals",
        "values": vars(values),
        "_postman_variable_scope": "globals",
        "_postman_exported_at": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "_postman_exported_using": "Cartero",
    })
}

/// Todo un workspace en un fichero (lo mismo que exporta la web).
pub fn workspace(name: &str, collections: &[Collection], environments: &[Environment], globals: &[Variable]) -> Value {
    json!({
        "cartero": 1,
        "name": name,
        "collections": collections.iter().map(collection).collect::<Vec<_>>(),
        "environments": environments.iter().map(environment).collect::<Vec<_>>(),
        "globals": vars(globals),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::import_any;

    fn fixture(name: &str) -> String {
        std::fs::read_to_string(format!("{}/../../../packages/importers/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap()
    }

    fn strip_ids(v: &Value) -> Value {
        match v {
            Value::Array(a) => Value::Array(a.iter().map(strip_ids).collect()),
            Value::Object(o) => {
                Value::Object(o.iter().filter(|(k, _)| k.as_str() != "id").map(|(k, v)| (k.clone(), strip_ids(v))).collect())
            }
            other => other.clone(),
        }
    }

    #[test]
    fn ida_y_vuelta_sin_perdidas() {
        let original: Value = serde_json::from_str(&fixture("postman-v21.json")).unwrap();
        let r = import_any(&fixture("postman-v21.json")).unwrap();
        let exported = collection(&r.collections[0]);
        assert_eq!(strip_ids(&exported), strip_ids(&original));
        // y el orden de las claves es el de Postman
        let keys: Vec<_> = exported.as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys, vec!["info", "item", "auth", "event", "variable"]);
    }

    #[test]
    fn exportar_e_importar_es_estable() {
        let r = import_any(&fixture("postman-v21.json")).unwrap();
        let once = collection(&r.collections[0]);
        let again = import_any(&once.to_string()).unwrap();
        assert_eq!(collection(&again.collections[0]), once);
    }

    #[test]
    fn entornos_ida_y_vuelta() {
        let r = import_any(&fixture("postman-env.json")).unwrap();
        let exported = environment(&r.environments[0]);
        let back = import_any(&exported.to_string()).unwrap();
        assert_eq!(back.environments[0].values, r.environments[0].values);
        let w = workspace("W", &r.collections, &r.environments, &[Variable::new("g", "1")]);
        let back = import_any(&w.to_string()).unwrap();
        assert_eq!(back.format, "cartero-workspace");
        assert_eq!(back.globals.unwrap()[0].key, "g");
    }
}
