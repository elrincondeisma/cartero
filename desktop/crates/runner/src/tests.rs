use super::*;
use cartero_model::{Auth, Event, Request};
use std::sync::atomic::AtomicBool;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// Servidor que devuelve JSON con el método, la ruta y las cabeceras recibidas
async fn server() -> std::net::SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let (mut s, _) = listener.accept().await.unwrap();
            tokio::spawn(async move {
                let mut buf = vec![0; 16384];
                let n = s.read(&mut buf).await.unwrap_or(0);
                let raw = String::from_utf8_lossy(&buf[..n]).to_string();
                let mut lines = raw.lines();
                let first: Vec<&str> = lines.next().unwrap_or_default().split(' ').collect();
                let headers: serde_json::Map<String, Value> = lines
                    .take_while(|l| !l.is_empty())
                    .filter_map(|l| l.split_once(':'))
                    .map(|(k, v)| (k.trim().to_lowercase(), Value::String(v.trim().to_string())))
                    .collect();
                let path = first.get(1).copied().unwrap_or("/");
                let status = if path.starts_with("/fail") { "500 Internal Server Error" } else { "200 OK" };
                let body = json!({ "method": first[0], "path": path, "headers": headers }).to_string();
                let extra = if path.starts_with("/login") { "set-cookie: sid=s1; Path=/\r\n" } else { "" };
                let res = format!(
                    "HTTP/1.1 {status}\r\ncontent-type: application/json\r\n{extra}content-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = s.write_all(res.as_bytes()).await;
            });
        }
    });
    addr
}

fn req(name: &str, url: &str, test: &str) -> Item {
    let mut i = Item::request(name, Request::new("GET", url));
    if !test.is_empty() {
        i.event = Some(vec![Event::new("test", test)]);
    }
    i
}

fn ctx(collection: Collection, base: &str) -> RunContext {
    let mut vars = VarState::default();
    vars.environment.insert("base".into(), base.into());
    vars.environment_name = "Local".into();
    RunContext { collection, vars, options: Options::default(), jar: Arc::new(Mutex::new(CookieJar::new())), limits: Limits::default() }
}

#[tokio::test(flavor = "multi_thread")]
async fn cadena_de_scripts_auth_heredada_y_variables() {
    let addr = server().await;
    let mut c = Collection::new("API");
    c.event = Some(vec![Event::new("prerequest", "pm.variables.set('who', 'colección')")]);
    let mut auth = Auth::new("bearer");
    auth.set("token", "{{token}}");
    c.auth = Some(Some(auth));
    let mut folder = Item::folder("Users");
    folder.event = Some(vec![Event::new("prerequest", "pm.environment.set('token', 'T-' + pm.variables.get('who'))")]);
    let mut r = req(
        "List",
        "{{base}}/users",
        "pm.test('auth', () => pm.expect(pm.response.json().headers.authorization).to.equal('Bearer T-colección'))\npm.environment.set('seen', pm.response.json().path)",
    );
    r.event.as_mut().unwrap().push(Event::new("prerequest", "pm.request.headers.add({key:'X-Pre', value:'1'})"));
    folder.item = Some(vec![r.clone()]);
    c.item = vec![folder];
    let mut ctx = ctx(c, &format!("http://{addr}"));
    let out = execute(&mut ctx, &r, &ExecOptions::default()).await;
    assert!(out.error.is_none(), "{:?}", out.error);
    assert_eq!(out.prepared.header("x-pre"), Some("1"));
    assert!(out.tests.iter().all(|t| t.passed) && out.tests.len() == 1, "{:?} {:?}", out.tests, out.script_errors);
    assert_eq!(ctx.vars.environment["seen"], "/users");
    let (changed, _) = diff(&Default::default(), &ctx.vars.environment);
    assert!(changed.contains_key("token"));
}

#[tokio::test(flavor = "multi_thread")]
async fn runner_iteraciones_datos_y_next_request() {
    let addr = server().await;
    let mut c = Collection::new("Flujo");
    let login = req("Login", "{{base}}/login?u={{user}}", "pm.test('login', () => pm.response.to.be.ok)");
    let mut skip = req("Saltada", "{{base}}/skip", "");
    skip.event = Some(vec![Event::new("prerequest", "pm.execution.skipRequest()")]);
    let me = req(
        "Me",
        "{{base}}/me",
        "pm.test('cookie', () => pm.expect(pm.response.json().headers.cookie).to.equal('sid=s1'))\npm.execution.setNextRequest(null)",
    );
    let never = req("Nunca", "{{base}}/never", "");
    c.item = vec![login, skip, me, never];
    let mut ctx = ctx(c, &format!("http://{addr}"));
    let data = data::parse("user\nana\nluis").unwrap();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let summary =
        run_collection(&mut ctx, RunConfig { iterations: 1, data, ..Default::default() }, tx, Arc::new(AtomicBool::new(false))).await;
    assert_eq!(summary.iterations, 2);
    let names: Vec<_> = summary.results.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(names, vec!["Login", "Saltada", "Me", "Login", "Saltada", "Me"]);
    assert!(summary.results[0].url.ends_with("u=ana") && summary.results[3].url.ends_with("u=luis"));
    assert!(summary.results[1].skipped);
    assert_eq!(summary.tests_failed, 0, "{:#?}", summary.results);
    assert_eq!(summary.requests, 4);
    let mut events = 0;
    while rx.try_recv().is_ok() {
        events += 1;
    }
    assert_eq!(events, 1 + 6 * 2 + 1);
    let junit = report::junit(&summary);
    assert!(junit.contains("<testsuites name=\"Flujo\" tests=\"4\" failures=\"0\""));
}

#[tokio::test(flavor = "multi_thread")]
async fn bail_y_send_request() {
    let addr = server().await;
    let mut c = Collection::new("Bail");
    let a = req("Falla", "{{base}}/fail", "pm.test('ok', () => pm.response.to.be.ok)");
    let b = req("Otra", "{{base}}/x", "");
    c.item = vec![a, b];
    let mut ctx2 = ctx(c, &format!("http://{addr}"));
    let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
    let s = run_collection(&mut ctx2, RunConfig { iterations: 1, bail: true, ..Default::default() }, tx, Arc::new(AtomicBool::new(false)))
        .await;
    assert_eq!(s.results.len(), 1);
    assert_eq!(s.tests_failed, 1);

    let mut c = Collection::new("SR");
    let r =
        req("SR", "{{base}}/a", &format!("pm.sendRequest('http://{addr}/token', (e, res) => pm.environment.set('p', res.json().path))"));
    c.item = vec![r.clone()];
    let mut ctx3 = ctx(c, &format!("http://{addr}"));
    let out = execute(&mut ctx3, &r, &ExecOptions::default()).await;
    assert!(out.script_errors.is_empty(), "{:?}", out.script_errors);
    assert_eq!(ctx3.vars.environment["p"], "/token");
}
