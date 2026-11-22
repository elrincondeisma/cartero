//! Prueba contra un servidor de Cartero real. Se ejecuta si existe CARTERO_SYNC_TEST_URL
//! (por ejemplo, la instancia aislada de scripts/e2e-servers.sh) con un token en
//! CARTERO_SYNC_TEST_TOKEN.

use cartero_model::{Environment, Item, Request, Variable};
use cartero_store::Store;
use cartero_sync::Client;

fn env() -> Option<(String, String)> {
    Some((std::env::var("CARTERO_SYNC_TEST_URL").ok()?, std::env::var("CARTERO_SYNC_TEST_TOKEN").ok()?))
}

#[tokio::test(flavor = "multi_thread")]
async fn sube_baja_y_detecta_conflictos() {
    let Some((url, token)) = env() else {
        eprintln!("CARTERO_SYNC_TEST_URL no definido: prueba omitida");
        return;
    };
    let client = Client::new(&url, &token, Default::default());
    let me = client.me().await.unwrap();
    let remote = client.create_workspace(&format!("Escritorio {}", std::process::id())).await.unwrap();

    // Ordenador A: crea contenido y lo sube
    let a = Store::in_memory().unwrap();
    let wa = a.create_workspace("A").unwrap();
    a.link_workspace(&wa.id, Some("srv"), Some(&remote.id)).unwrap();
    let c = a.create_collection(&wa.id, "Compartida").unwrap();
    let folder = a.create_item(&c, None, 0, &Item::folder("Carpeta")).unwrap();
    let req = a.create_item(&c, Some(&folder), 0, &Item::request("Ping", Request::new("GET", "https://x.io/ping"))).unwrap();
    a.create_environment(&wa.id, &Environment { id: None, name: "Prod".into(), values: vec![Variable::new("base", "https://x.io")] }).unwrap();
    a.save_globals(&wa.id, &[Variable::new("g", "1")]).unwrap();
    let r = client.sync(&a, &wa.id, &remote.id).await.unwrap();
    assert_eq!(r.conflicts, 0, "{r:?}");
    assert!(r.pushed >= 5, "{r:?}");
    assert!(a.pending(&wa.id).unwrap().is_empty());

    // Ordenador B: baja todo
    let b = Store::in_memory().unwrap();
    let wb = b.create_workspace("B").unwrap();
    b.link_workspace(&wb.id, Some("srv"), Some(&remote.id)).unwrap();
    client.sync(&b, &wb.id, &remote.id).await.unwrap();
    let tree = b.collection(&c).unwrap();
    assert_eq!(tree.item[0].name, "Carpeta");
    assert_eq!(tree.item[0].children()[0].request.as_ref().unwrap().url.raw(), "https://x.io/ping");
    assert_eq!(b.environments(&wb.id).unwrap()[0].name, "Prod");
    assert_eq!(b.globals(&wb.id).unwrap()[0].key, "g");

    // B cambia la petición y sube; A también la cambia sin bajar antes → conflicto en A
    let mut item_b = b.item(&req).unwrap();
    item_b.name = "Ping (B)".into();
    b.save_item(&item_b).unwrap();
    client.push(&b, &wb.id, &remote.id).await.unwrap();
    let mut item_a = a.item(&req).unwrap();
    item_a.name = "Ping (A)".into();
    a.save_item(&item_a).unwrap();
    let r = client.push(&a, &wa.id, &remote.id).await.unwrap();
    assert_eq!(r.conflicts, 1);
    let conflicts = a.conflicts(&wa.id).unwrap();
    assert_eq!(conflicts[0].remote["name"], "Ping (B)");
    assert_eq!(conflicts[0].local["name"], "Ping (A)");
    // A se queda con la suya: se sube forzando
    a.resolve_conflict(&wa.id, &conflicts[0], true).unwrap();
    let r = client.push(&a, &wa.id, &remote.id).await.unwrap();
    assert_eq!((r.pushed, r.conflicts), (1, 0));
    // B baja y ve el cambio de A; luego A borra la carpeta y B la pierde también
    client.sync(&b, &wb.id, &remote.id).await.unwrap();
    assert_eq!(b.item(&req).unwrap().name, "Ping (A)");
    a.delete_item(&folder).unwrap();
    client.sync(&a, &wa.id, &remote.id).await.unwrap();
    client.sync(&b, &wb.id, &remote.id).await.unwrap();
    assert!(b.collection(&c).unwrap().item.is_empty());
    let _ = me;
}
