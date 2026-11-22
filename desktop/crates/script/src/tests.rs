use super::*;
use serde_json::json;

fn response(code: u16, body: Value) -> ScriptResponse {
    ScriptResponse {
        code,
        status: "OK".into(),
        headers: vec![
            Header { key: "Content-Type".into(), value: "application/json".into() },
            Header { key: "Set-Cookie".into(), value: "sid=abc; Path=/; HttpOnly".into() },
        ],
        body: body.to_string(),
        response_time: 42,
        response_size: 10,
    }
}

fn input(script: &str, resp: Option<ScriptResponse>) -> ScriptInput {
    let mut vars = Map::new();
    vars.insert("environment".into(), json!({ "baseUrl": "http://localhost" }));
    vars.insert("collection".into(), json!({ "c": "col" }));
    ScriptInput {
        script: script.into(),
        event: if resp.is_some() { "test" } else { "prerequest" }.into(),
        request_name: "Get user".into(),
        variables: vars,
        request: json!({ "method": "GET", "url": "{{baseUrl}}/users?page=1", "header": [{ "key": "Accept", "value": "*/*" }] }),
        response: resp,
        ..Default::default()
    }
}

fn exec(script: &str, resp: Option<ScriptResponse>) -> ScriptOutput {
    run(&input(script, resp), &Limits::default(), Arc::new(NoHost)).unwrap()
}

#[test]
fn tests_de_postman_y_variables() {
    // Los mismos scripts que usa la suite del servidor con postman-runtime
    let out = exec(
        r#"
        pm.test("ok", () => pm.response.to.have.status(200))
        pm.test("es json", () => pm.response.to.have.header("Content-Type", "application/json"))
        pm.test("falla", () => pm.expect(pm.response.json().id).to.equal(2))
        pm.environment.set("last", pm.response.json().url)
        pm.environment.set("n", 5)
        console.log("id", pm.response.json().id, { a: 1 })
    "#,
        Some(response(200, json!({ "id": 1, "url": "/users?page=1" }))),
    );
    assert_eq!(out.tests.len(), 3);
    assert!(out.tests[0].passed && out.tests[1].passed);
    assert!(!out.tests[2].passed);
    assert_eq!(out.tests[2].error.as_deref(), Some("expected 1 to equal 2"));
    assert_eq!(out.scope("environment")["last"], "/users?page=1");
    assert_eq!(out.scope("environment")["n"], "5");
    assert_eq!(out.scope("environment")["baseUrl"], "http://localhost");
    assert_eq!(out.console[0].text, "id 1 {\"a\":1}");
    assert!(out.error.is_none());
}

#[test]
fn aserciones_de_respuesta() {
    let out = exec(
        r#"
        pm.test("ok", () => pm.response.to.be.ok)
        pm.test("success", () => pm.response.to.be.success)
        pm.test("json", () => pm.response.to.be.json)
        pm.test("withBody", () => pm.response.to.be.withBody)
        pm.test("jsonBody", () => pm.response.to.have.jsonBody("user.name", "Ana"))
        pm.test("cookie", () => pm.response.to.have.cookie("sid", "abc"))
        pm.test("not found", () => pm.response.to.not.be.notFound)
        pm.test("schema", () => pm.response.to.have.jsonSchema({ type: "object", required: ["user"] }))
        pm.test("chai ok normal", () => pm.expect(1).to.be.ok)
        pm.test("falla 404", () => pm.response.to.be.notFound)
    "#,
        Some(response(200, json!({ "user": { "name": "Ana" } }))),
    );
    let failed: Vec<_> = out.tests.iter().filter(|t| !t.passed).map(|t| t.name.as_str()).collect();
    assert_eq!(failed, vec!["falla 404"], "{:?}", out.tests);
}

#[test]
fn librerias_como_en_postman() {
    let out = exec(
        r#"
        const _ = require('lodash')
        const CryptoJS = require('crypto-js')
        const moment = require('moment')
        const uuid = require('uuid')
        pm.test("lodash", () => pm.expect(_.sum([1, 2, 3])).to.equal(6))
        pm.test("crypto-js", () => pm.expect(CryptoJS.SHA256("cartero").toString()).to.have.lengthOf(64))
        pm.test("moment", () => pm.expect(moment("2024-01-02").format("DD/MM/YYYY")).to.equal("02/01/2024"))
        pm.test("uuid", () => pm.expect(uuid.v4()).to.have.lengthOf(36))
        pm.test("btoa", () => pm.expect(atob(btoa("hola"))).to.equal("hola"))
        pm.test("xml2Json", () => pm.expect(xml2Json("<a><b>1</b></a>").a.b).to.equal("1"))
        pm.test("cheerio", () => pm.expect(require('cheerio').load("<p class='x'>hi</p>")(".x").text()).to.equal("hi"))
        pm.test("csv", () => pm.expect(require('csv-parse/lib/sync')("a,b\n1,2", { columns: true })[0].b).to.equal("2"))
        pm.test("tv4", () => pm.expect(require('tv4').validate(1, { type: "number" })).to.be.true)
    "#,
        Some(response(201, json!({}))),
    );
    assert!(out.tests.iter().all(|t| t.passed), "{:?}", out.tests);
    assert_eq!(out.tests.len(), 9);
}

#[test]
fn pre_request_cambia_la_peticion_y_variables_locales() {
    let out = exec(
        r#"
        pm.request.headers.add({ key: "X-Ts", value: "1" })
        pm.request.headers.upsert({ key: "Accept", value: "application/json" })
        pm.request.url.query.add({ key: "extra", value: "si" })
        pm.request.method = "POST"
        pm.variables.set("token", "abc")
        pm.test("replaceIn", () => pm.expect(pm.variables.replaceIn("{{baseUrl}}/{{c}}")).to.equal("http://localhost/col"))
        pm.test("host", () => pm.expect(pm.request.url.getHost()).to.equal("{{baseUrl}}"))
        pm.execution.setNextRequest("Login")
    "#,
        None,
    );
    let req = out.request.clone().unwrap();
    assert_eq!(req["method"], "POST");
    assert_eq!(req["url"], "{{baseUrl}}/users?page=1&extra=si");
    assert_eq!(req["header"][0]["value"], "application/json");
    assert_eq!(req["header"][1]["key"], "X-Ts");
    assert_eq!(out.local["token"], "abc");
    assert!(out.tests.iter().all(|t| t.passed), "{:?}", out.tests);
    assert_eq!(out.next(), NextRequest::Named("Login".into()));
    let out = exec("postman.setNextRequest(null)", None);
    assert_eq!(out.next(), NextRequest::Stop);
    assert_eq!(exec("1", None).next(), NextRequest::Unchanged);
}

struct FakeHost;
impl Host for FakeHost {
    fn send_request(&self, req: Value) -> Result<Value, String> {
        Ok(
            json!({ "code": 200, "status": "OK", "headers": [{ "key": "Content-Type", "value": "application/json" }], "body": json!({ "echo": req["url"] }).to_string(), "responseTime": 3 }),
        )
    }
    fn cookie(&self, op: Value) -> Result<Value, String> {
        Ok(json!({ "op": op["op"], "name": op["name"] }))
    }
}

#[test]
fn send_request_promesas_y_temporizadores() {
    let script = r#"
        pm.sendRequest("https://x.io/token", (err, res) => {
            pm.environment.set("echo", res.json().echo)
        })
        pm.test("async", async () => {
            const res = await pm.sendRequest({ url: "https://x.io/b", method: "POST" })
            pm.expect(res.code).to.equal(200)
        })
        pm.test("done", (done) => setTimeout(() => { pm.expect(1).to.equal(1); done() }, 10))
        pm.cookies.jar().get("https://x.io", "sid", (err, c) => pm.globals.set("jar", c.op))
        setTimeout(() => console.log("tarde"), 50)
        setTimeout(() => console.log("pronto"), 5)
    "#;
    let out = run(&input(script, None), &Limits::default(), Arc::new(FakeHost)).unwrap();
    assert_eq!(out.scope("environment")["echo"], "https://x.io/token");
    assert_eq!(out.scope("globals")["jar"], "get");
    assert!(out.tests.iter().all(|t| t.passed), "{:?}", out.tests);
    let logs: Vec<_> = out.console.iter().map(|l| l.text.as_str()).collect();
    assert_eq!(logs, vec!["pronto", "tarde"]);
}

#[test]
fn api_antigua() {
    let out = exec(
        r#"
        tests["status 200"] = responseCode.code === 200
        tests["cuerpo"] = JSON.parse(responseBody).id === 1
        postman.setEnvironmentVariable("x", "1")
    "#,
        Some(response(200, json!({ "id": 1 }))),
    );
    assert!(out.tests.iter().all(|t| t.passed) && out.tests.len() == 2, "{:?}", out.tests);
    assert_eq!(out.scope("environment")["x"], "1");
}

#[test]
fn errores_del_script_y_modulos_desconocidos() {
    let out = exec("require('fs')", None);
    assert!(out.error.unwrap().contains("Cannot find module 'fs'"));
    let out = exec("pm.test('x', function (done) { })", None);
    assert!(!out.tests[0].passed);
}

#[test]
fn un_bucle_infinito_se_corta() {
    let limits = Limits { timeout: Duration::from_millis(300), ..Default::default() };
    let start = Instant::now();
    let r = run(&input("while (true) {}", None), &limits, Arc::new(NoHost));
    match r {
        Ok(out) => assert!(out.error.unwrap().contains("interrupted")),
        Err(e) => assert!(matches!(e, ScriptError::Timeout(_)), "{e}"),
    }
    assert!(start.elapsed() < Duration::from_secs(3));
}

#[test]
fn el_coste_de_arranque_es_bajo() {
    let start = Instant::now();
    for _ in 0..10 {
        exec("pm.test('x', () => {})", None);
    }
    let per_run = start.elapsed() / 10;
    eprintln!("arranque por ejecución: {per_run:?}");
    assert!(per_run < Duration::from_millis(150), "{per_run:?}");
}
