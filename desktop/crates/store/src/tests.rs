use super::*;
use cartero_model::import::import_any;

fn fixture(name: &str) -> String {
    std::fs::read_to_string(format!("{}/../../../packages/importers/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap()
}

#[test]
fn importar_cargar_y_exportar_igual() {
    let s = Store::in_memory().unwrap();
    let ws = s.create_workspace("Personal").unwrap();
    let original = import_any(&fixture("postman-v21.json")).unwrap().collections.remove(0);
    let id = s.import_collection(&ws.id, &original).unwrap();
    let loaded = s.collection(&id).unwrap();
    let strip = |c: &Collection| {
        let mut v = cartero_model::export::collection(c);
        fn go(v: &mut Value) {
            match v {
                Value::Object(o) => {
                    o.remove("id");
                    o.remove("_postman_id");
                    o.values_mut().for_each(go);
                }
                Value::Array(a) => a.iter_mut().for_each(go),
                _ => {}
            }
        }
        go(&mut v);
        v
    };
    assert_eq!(strip(&loaded), strip(&original));
    let metas = s.collections(&ws.id).unwrap();
    assert_eq!((metas[0].name.as_str(), metas[0].requests), ("Demo API", 3));
}

#[test]
fn arbol_crear_mover_duplicar_borrar() {
    let s = Store::in_memory().unwrap();
    let ws = s.create_workspace("W").unwrap();
    let c = s.create_collection(&ws.id, "C").unwrap();
    let f = s.create_item(&c, None, 0, &Item::folder("F")).unwrap();
    let a = s.create_item(&c, None, 1, &Item::request("A", cartero_model::Request::new("GET", "https://a"))).unwrap();
    let b = s.create_item(&c, None, 1, &Item::request("B", cartero_model::Request::new("GET", "https://b"))).unwrap();
    let names = |s: &Store| s.collection(&c).unwrap().item.iter().map(|i| i.name.clone()).collect::<Vec<_>>();
    assert_eq!(names(&s), vec!["F", "B", "A"]);
    s.move_item(&a, &c, Some(&f), 0).unwrap();
    assert_eq!(names(&s), vec!["F", "B"]);
    assert_eq!(s.collection(&c).unwrap().item[0].children()[0].name, "A");
    assert!(s.move_item(&f, &c, Some(&f), 0).is_err());
    let copy = s.duplicate_item(&f).unwrap();
    let col = s.collection(&c).unwrap();
    assert_eq!(col.item[1].name, "F (copia)");
    assert_eq!(col.item[1].children()[0].name, "A");
    assert_ne!(col.item[1].children()[0].id(), a);
    s.delete_item(&copy).unwrap();
    assert_eq!(names(&s), vec!["F", "B"]);
    let mut item = s.item(&b).unwrap();
    item.request.as_mut().unwrap().method = "POST".into();
    item.name = "B2".into();
    s.save_item(&item).unwrap();
    assert_eq!(s.item(&b).unwrap().request.unwrap().method, "POST");
    // a otra colección
    let c2 = s.create_collection(&ws.id, "C2").unwrap();
    s.move_item(&f, &c2, None, 0).unwrap();
    assert_eq!(s.collection(&c2).unwrap().item[0].children()[0].name, "A");
    assert_eq!(names(&s), vec!["B2"]);
}

#[test]
fn entornos_con_secretos_cifrados() {
    let s = Store::in_memory().unwrap();
    let ws = s.create_workspace("W").unwrap();
    let mut token = Variable::new("token", "s3cr3t");
    token.kind = Some("secret".into());
    let env = Environment { id: None, name: "Prod".into(), values: vec![Variable::new("base", "https://x"), token] };
    let id = s.create_environment(&ws.id, &env).unwrap();
    let raw: String = s.with_conn(|c| Ok(c.query_row("SELECT \"values\" FROM environments", [], |r| r.get(0))?)).unwrap();
    assert!(!raw.contains("s3cr3t") && raw.contains("enc:v1:"));
    let back = s.environment(&id).unwrap();
    assert_eq!(back.values[1].value_str(), "s3cr3t");
    s.save_globals(&ws.id, &[Variable::new("g", "1")]).unwrap();
    assert_eq!(s.globals(&ws.id).unwrap()[0].key, "g");
    assert_eq!(s.environments(&ws.id).unwrap()[0].name, "Prod");
}

#[test]
fn historial_ajustes_y_cookies() {
    let s = Store::in_memory().unwrap();
    let ws = s.create_workspace("W").unwrap();
    for i in 0..3 {
        s.add_history(&HistoryEntry {
            id: format!("h{i}"),
            workspace_id: ws.id.clone(),
            item_id: None,
            method: "GET".into(),
            url: format!("https://x/{i}"),
            status: Some(200),
            time_ms: Some(10),
            request: serde_json::json!({ "name": "x" }),
            created_at: format!("2026-01-0{}T00:00:00Z", i + 1),
        })
        .unwrap();
    }
    let h = s.history(&ws.id, 10).unwrap();
    assert_eq!(h[0].url, "https://x/2");
    assert_eq!(s.pending_history(&ws.id, 10).unwrap().len(), 3);
    s.mark_history_uploaded(&["h0".into()]).unwrap();
    assert_eq!(s.pending_history(&ws.id, 10).unwrap().len(), 2);
    s.set_setting("theme", &"dark").unwrap();
    assert_eq!(s.setting::<String>("theme").as_deref(), Some("dark"));
    s.save_cookie_jar(&ws.id, "[]").unwrap();
    assert_eq!(s.cookie_jar(&ws.id).unwrap().as_deref(), Some("[]"));
    // borrar el workspace borra todo lo suyo
    s.delete_workspace(&ws.id).unwrap();
    assert!(s.history(&ws.id, 10).unwrap().is_empty());
}

#[test]
fn versiones_del_contrato_al_guardar() {
    let s = Store::in_memory().unwrap();
    let ws = s.create_workspace("W").unwrap();
    let c = s.import_collection(&ws.id, &import_any(&fixture("postman-v21.json")).unwrap().collections.remove(0)).unwrap();
    let row = s.item_rows(&c).unwrap().into_iter().find(|r| r.kind == "request").unwrap();
    let mut item = s.item(&row.id).unwrap();

    // Guardar sin contrato no crea versiones
    s.save_item(&item).unwrap();
    assert!(s.contract_versions(&row.id).unwrap().is_empty());

    let v1 = serde_json::json!({ "responses": { "200": { "body": { "type": "object" } } } });
    item.extra.insert("contract".into(), v1.clone());
    s.save_item(&item).unwrap();
    s.save_item(&item).unwrap(); // sin cambios: no hay versión nueva
    let v2 = serde_json::json!({ "responses": { "200": {}, "404": {} } });
    item.extra.insert("contract".into(), v2.clone());
    s.save_item(&item).unwrap();

    let versions = s.contract_versions(&row.id).unwrap();
    assert_eq!(versions.len(), 2);
    assert_eq!((versions[0].before.as_ref(), versions[0].after.as_ref()), (Some(&v1), Some(&v2)));
    assert_eq!((versions[1].before.as_ref(), versions[1].after.as_ref()), (None, Some(&v1)));
    assert_eq!(s.item(&row.id).unwrap().extra.get("contract"), Some(&v2));

    s.delete_item(&row.id).unwrap();
    assert!(s.contract_versions(&row.id).unwrap().is_empty());
}
