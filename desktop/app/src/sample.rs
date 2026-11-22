//! Datos de ejemplo de la primera vez: una colección contra httpbin.org con tests y un entorno.

use cartero_model::{Auth, Body, Collection, Environment, Event, Item, KeyValue, Request, Variable};
use cartero_store::Store;

use crate::i18n::tr;

pub fn collection() -> Collection {
    let mut c = Collection::new(tr("Ejemplos de Cartero").as_ref());
    c.info.description = Some(
        tr("Peticiones de ejemplo contra httpbin.org. Pulsa Enviar en cualquiera para ver la respuesta, los tests y los tiempos.")
            .to_string()
            .into(),
    );
    let mut get = Item::request(tr("Leer datos (GET)").as_ref(), Request::new("GET", "{{baseUrl}}/get?lang=es&page=1"));
    get.event = Some(vec![Event::new(
        "test",
        "pm.test(\"Responde 200\", () => pm.response.to.have.status(200))\npm.test(\"Recibe el parámetro page\", () => {\n  pm.expect(pm.response.json().args.page).to.equal(\"1\")\n})",
    )]);
    let mut post_req = Request::new("POST", "{{baseUrl}}/post");
    post_req.header = Some(vec![KeyValue::new("X-Cartero", "{{$guid}}")]);
    let mut b =
        Body { mode: Some("raw".into()), raw: Some("{\n  \"nombre\": \"Ana\",\n  \"rol\": \"admin\"\n}".into()), ..Default::default() };
    b.set_raw_language("json");
    post_req.body = Some(b);
    let mut post = Item::request(tr("Crear un usuario (POST JSON)").as_ref(), post_req);
    post.event = Some(vec![Event::new(
        "test",
        "const body = pm.response.json()\npm.test(\"Devuelve lo que enviamos\", () => pm.expect(body.json.nombre).to.equal(\"Ana\"))\npm.environment.set(\"ultimoUsuario\", body.json.nombre)",
    )]);
    let mut auth_req = Request::new("GET", "{{baseUrl}}/basic-auth/cartero/{{password}}");
    let mut a = Auth::new("basic");
    a.set("username", "cartero");
    a.set("password", "{{password}}");
    auth_req.auth = Some(Some(a));
    let mut auth = Item::request(tr("Autenticación básica").as_ref(), auth_req);
    auth.event = Some(vec![Event::new("test", "pm.test(\"Autenticado\", () => pm.response.to.have.jsonBody(\"authenticated\", true))")]);
    let mut folder = Item::folder(tr("Errores y redirecciones").as_ref());
    folder.item = Some(vec![
        Item::request(tr("No encontrado (404)").as_ref(), Request::new("GET", "{{baseUrl}}/status/404")),
        Item::request(tr("Redirección").as_ref(), Request::new("GET", "{{baseUrl}}/redirect/2")),
        Item::request(tr("Respuesta lenta").as_ref(), Request::new("GET", "{{baseUrl}}/delay/1")),
    ]);
    c.item = vec![get, post, auth, folder];
    c
}

pub fn environment() -> Environment {
    let mut password = Variable::new("password", "s3cr3t");
    password.kind = Some("secret".into());
    Environment { id: None, name: "httpbin".into(), values: vec![Variable::new("baseUrl", "https://httpbin.org"), password] }
}

pub fn create(store: &Store, workspace: &str) {
    let _ = store.import_collection(workspace, &collection());
    if let Ok(id) = store.create_environment(workspace, &environment()) {
        let _ = store.set_setting(&format!("env:{workspace}"), &Some(id));
    }
}
