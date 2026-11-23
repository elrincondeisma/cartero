//! Pestaña «Contrato» de una petición: lo que envía el frontend y lo que debe devolver el
//! backend en cada código. Se edita con un árbol de campos o como JSON Schema, igual que en la web.
//! El contrato se guarda en `item.extra["contract"]`.

use std::collections::HashSet;

use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::checkbox::Checkbox;
use gpui_kit::component::input::{Editor, EditorState, Input, InputEvent, InputState};
use serde_json::{Map, Value, json};

use crate::contracts;
use crate::state::AppState;
use crate::ui::prelude::*;
use crate::ui::widgets::{choice, empty_state, relative_time};

const TYPES: [&str; 7] = ["string", "number", "integer", "boolean", "object", "array", "null"];
const FORMATS: [&str; 8] = ["", "email", "uuid", "date-time", "date", "time", "uri", "ipv4"];

fn type_label(t: &str) -> SharedString {
    match t {
        "string" => tr("Texto"),
        "number" => tr("Número"),
        "integer" => tr("Entero"),
        "boolean" => tr("Sí/No"),
        "object" => tr("Objeto"),
        "array" => tr("Lista"),
        "null" => tr("Nulo"),
        _ => tr("Cualquiera"),
    }
}

fn type_options() -> Vec<(SharedString, String)> {
    TYPES.iter().map(|t| (type_label(t), t.to_string())).collect()
}

// ───────────────────────────── Esquemas ─────────────────────────────

/// Tipo principal de un esquema y si admite null (`type: ["string","null"]` o `nullable: true`).
fn main_type(s: &Value) -> (Option<String>, bool) {
    let nullable_flag = s.get("nullable").and_then(Value::as_bool).unwrap_or(false);
    match s.get("type") {
        Some(Value::String(t)) => (Some(t.clone()), nullable_flag && t != "null"),
        Some(Value::Array(a)) => {
            let types: Vec<&str> = a.iter().filter_map(Value::as_str).collect();
            let main = types.iter().find(|t| **t != "null").map(|t| t.to_string());
            let nullable = types.contains(&"null") && main.is_some();
            (main.or_else(|| types.first().map(|t| t.to_string())), nullable || nullable_flag)
        }
        _ => {
            if s.get("properties").is_some() {
                (Some("object".into()), nullable_flag)
            } else if s.get("items").is_some() {
                (Some("array".into()), nullable_flag)
            } else {
                (None, nullable_flag)
            }
        }
    }
}

/// El mismo esquema con otro tipo (limpia lo que ya no aplica y añade lo que falta).
fn with_type(schema: &Value, t: &str, nullable: bool) -> Value {
    let mut s = schema.as_object().cloned().unwrap_or_default();
    s.remove("nullable");
    s.insert("type".into(), if nullable && t != "null" { json!([t, "null"]) } else { json!(t) });
    if t == "object" {
        s.entry("properties").or_insert_with(|| json!({}));
        s.entry("required").or_insert_with(|| json!([]));
    } else {
        s.remove("properties");
        s.remove("required");
        s.remove("additionalProperties");
    }
    if t == "array" {
        s.entry("items").or_insert_with(|| json!({ "type": "string" }));
    } else {
        s.remove("items");
    }
    if t != "string" {
        s.remove("format");
    }
    let (old, _) = main_type(schema);
    if old.as_deref() != Some(t) {
        s.remove("enum");
        s.remove("example");
    }
    Value::Object(s)
}

#[derive(Clone, Debug, PartialEq)]
enum Seg {
    Prop(String),
    Items,
}

fn at_mut<'a>(root: &'a mut Value, path: &[Seg]) -> Option<&'a mut Value> {
    let mut cur = root;
    for seg in path {
        cur = match seg {
            Seg::Prop(k) => cur.get_mut("properties")?.get_mut(k)?,
            Seg::Items => cur.get_mut("items")?,
        };
    }
    Some(cur)
}

fn at<'a>(root: &'a Value, path: &[Seg]) -> Option<&'a Value> {
    let mut cur = root;
    for seg in path {
        cur = match seg {
            Seg::Prop(k) => cur.get("properties")?.get(k)?,
            Seg::Items => cur.get("items")?,
        };
    }
    Some(cur)
}

fn path_key(target: &Target, path: &[Seg]) -> String {
    let mut s = match target {
        Target::Request => "req".to_string(),
        Target::Response(c) => format!("res:{c}"),
    };
    for seg in path {
        match seg {
            Seg::Prop(k) => {
                s.push('.');
                s.push_str(k);
            }
            Seg::Items => s.push_str("[]"),
        }
    }
    s
}

fn show_loose(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
    }
}

/// Valor de ejemplo escrito a mano: JSON si se puede (7, true), texto si no.
fn parse_loose(text: &str, t: Option<&str>) -> Option<Value> {
    if text.is_empty() {
        return None;
    }
    if t == Some("string") {
        return Some(Value::String(text.into()));
    }
    Some(serde_json::from_str(text).unwrap_or_else(|_| Value::String(text.into())))
}

// ───────────────────────────── Filas ─────────────────────────────

#[derive(Clone, PartialEq)]
enum Target {
    Request,
    Response(String),
}

#[derive(Clone, Copy, PartialEq)]
enum ParamList {
    Path,
    Query,
    Header,
    ResponseHeader,
}

impl ParamList {
    fn key(self) -> &'static str {
        match self {
            ParamList::Path => "path",
            ParamList::Query => "query",
            ParamList::Header | ParamList::ResponseHeader => "headers",
        }
    }
}

enum Row {
    Section(SharedString),
    Param { list: ParamList, ix: usize, name: Entity<InputState>, desc: Entity<InputState> },
    AddParam(ParamList),
    Field { target: Target, path: Vec<Seg>, depth: usize, name: Option<Entity<InputState>>, details: Option<FieldDetails> },
    AddField { target: Target, path: Vec<Seg>, depth: usize },
    NoBody(Target),
    Description(Entity<InputState>),
}

struct FieldDetails {
    desc: Entity<InputState>,
    example: Entity<InputState>,
    values: Entity<InputState>,
}

#[derive(Clone, PartialEq)]
enum View {
    Request,
    Response(String),
    History,
    Json,
}

struct Version {
    when: String,
    summary: String,
    changes: Vec<(bool, String)>,
}

pub enum ContractEvent {
    Changed,
    /// Generar desde la última respuesta: necesita la parte de petición de la petición actual
    Generate,
    /// Empezar en blanco (también con la parte de petición actual)
    StartBlank,
    /// Completar la parte de petición con la petición actual
    FillFromRequest,
}

/// Última respuesta recibida, para generar el contrato desde ella.
#[derive(Clone)]
pub struct LastResponse {
    pub code: u16,
    pub reason: String,
    pub body: String,
}

pub struct ContractEditor {
    app: Entity<AppState>,
    item_id: Option<String>,
    contract: Option<Value>,
    view: View,
    rows: Vec<Row>,
    collapsed: HashSet<String>,
    expanded: HashSet<String>,
    json: Entity<EditorState>,
    json_error: Option<String>,
    history: Vec<Version>,
    pub last: Option<LastResponse>,
    readonly: bool,
    _subs: Vec<Subscription>,
    _json_sub: Subscription,
}

impl EventEmitter<ContractEvent> for ContractEditor {}

impl ContractEditor {
    pub fn new(app: Entity<AppState>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let json = cx.new(|cx| EditorState::new(window, cx).language("json").line_number(true).soft_wrap(true));
        let json_sub = cx.subscribe_in(&json, window, |this: &mut Self, _, ev: &InputEvent, _, cx| {
            if matches!(ev, InputEvent::Change) && this.view == View::Json {
                this.apply_json(cx);
            }
        });
        Self {
            app,
            item_id: None,
            contract: None,
            view: View::Request,
            rows: vec![],
            collapsed: HashSet::new(),
            expanded: HashSet::new(),
            json,
            json_error: None,
            history: vec![],
            last: None,
            readonly: false,
            _subs: vec![],
            _json_sub: json_sub,
        }
    }

    /// Carga el contrato de una petición (al abrirla o recargarla). No emite cambios.
    pub fn load(&mut self, contract: Option<Value>, item_id: Option<String>, window: &mut Window, cx: &mut Context<Self>) {
        self.contract = contract.filter(contracts::has_contract);
        self.item_id = item_id;
        let codes = self.codes();
        if !matches!(self.view, View::History | View::Json) || self.contract.is_none() {
            self.view = codes.first().map(|c| View::Response(c.clone())).unwrap_or(View::Request);
        }
        self.rebuild(window, cx);
    }

    /// La petición ya tiene id (al guardarla por primera vez): activa el historial.
    pub fn set_item_id(&mut self, id: Option<String>, cx: &mut Context<Self>) {
        self.item_id = id;
        if self.view == View::History {
            self.load_history(cx);
        }
        cx.notify();
    }

    /// El contrato tal como está, sin partes vacías (None si no hay nada).
    pub fn contract(&self) -> Option<Value> {
        let mut c = self.contract.clone()?;
        if let Some(req) = c.get_mut("request").and_then(Value::as_object_mut) {
            req.retain(|_, v| !(v.is_null() || v.as_array().is_some_and(|a| a.is_empty())));
            if req.is_empty() {
                c.as_object_mut().map(|o| o.remove("request"));
            }
        }
        contracts::has_contract(&c).then_some(c)
    }

    pub fn has_contract(&self) -> bool {
        self.contract().is_some()
    }

    fn codes(&self) -> Vec<String> {
        let mut codes: Vec<String> = self
            .contract
            .as_ref()
            .and_then(|c| c.get("responses"))
            .and_then(Value::as_object)
            .map(|o| o.keys().cloned().collect())
            .unwrap_or_default();
        codes.sort_by(|a, b| match (a.as_str(), b.as_str()) {
            ("default", _) => std::cmp::Ordering::Greater,
            (_, "default") => std::cmp::Ordering::Less,
            _ => a.cmp(b),
        });
        codes
    }

    fn c(&mut self) -> &mut Value {
        self.contract.get_or_insert_with(|| json!({ "responses": {} }))
    }

    fn changed(&mut self, cx: &mut Context<Self>) {
        cx.emit(ContractEvent::Changed);
        cx.notify();
    }

    // ───────────── Acciones que llegan desde la pestaña (necesitan la petición actual) ─────────────

    /// Genera el código de la última respuesta: tipos, formatos y ejemplos de su cuerpo.
    pub fn generate(&mut self, request_part: Value, window: &mut Window, cx: &mut Context<Self>) {
        let Some(last) = self.last.clone() else { return };
        let code = last.code.to_string();
        let body = contracts::infer(&last.body);
        let c = self.c();
        if c.get("request").is_none_or(Value::is_null) {
            c["request"] = request_part;
        }
        let responses = c["responses"].as_object_mut().expect("responses");
        let entry = responses.entry(code.clone()).or_insert_with(|| json!({}));
        if entry.get("description").and_then(Value::as_str).is_none_or(str::is_empty) {
            entry["description"] = json!(last.reason);
        }
        if let Some(b) = &body {
            entry["body"] = b.clone();
        }
        self.view = View::Response(code.clone());
        self.rebuild(window, cx);
        self.changed(cx);
        let msg = if body.is_some() {
            trf("Estructura del {code} generada desde la última respuesta. Revisa qué campos son obligatorios.", &[("code", &code)])
        } else {
            trf("La última respuesta no es JSON: se ha añadido el código {code} sin cuerpo.", &[("code", &code)])
        };
        window.push_notification(gpui_kit::component::notification::Notification::success(msg), cx);
    }

    pub fn start_blank(&mut self, request_part: Value, window: &mut Window, cx: &mut Context<Self>) {
        self.contract = Some(json!({
            "request": request_part,
            "responses": { "200": { "description": "OK", "body": { "type": "object", "properties": {}, "required": [] } } }
        }));
        self.view = View::Response("200".into());
        self.rebuild(window, cx);
        self.changed(cx);
    }

    /// Añade los parámetros que faltan sin tocar los que ya hay.
    pub fn fill_from_request(&mut self, part: Value, window: &mut Window, cx: &mut Context<Self>) {
        let c = self.c();
        let req = c.as_object_mut().unwrap().entry("request").or_insert_with(|| json!({}));
        if !req.is_object() {
            *req = json!({});
        }
        for key in ["path", "query", "headers"] {
            let extra = part.get(key).and_then(Value::as_array).cloned().unwrap_or_default();
            let list = req.as_object_mut().unwrap().entry(key).or_insert_with(|| json!([]));
            let arr = list.as_array_mut().unwrap();
            for p in extra {
                let name = p["name"].as_str().unwrap_or_default().to_lowercase();
                if !arr.iter().any(|q| q["name"].as_str().unwrap_or_default().to_lowercase() == name) {
                    arr.push(p);
                }
            }
        }
        if req.get("body").is_none_or(Value::is_null)
            && let Some(b) = part.get("body")
        {
            req["body"] = b.clone();
        }
        self.rebuild(window, cx);
        self.changed(cx);
    }

    // ───────────────────────────── Vistas ─────────────────────────────

    fn set_view(&mut self, view: View, window: &mut Window, cx: &mut Context<Self>) {
        self.view = view;
        if self.view == View::Json {
            let text =
                serde_json::to_string_pretty(&self.contract.clone().unwrap_or_else(|| json!({ "responses": {} }))).unwrap_or_default();
            self.json.update(cx, |s, cx| s.set_value(text, window, cx));
            self.json_error = None;
        }
        if self.view == View::History {
            self.load_history(cx);
        }
        self.rebuild(window, cx);
    }

    fn apply_json(&mut self, cx: &mut Context<Self>) {
        let text = self.json.read(cx).value().to_string();
        match serde_json::from_str::<Value>(&text) {
            Ok(v) if v.get("responses").is_some_and(Value::is_object) => {
                self.json_error = None;
                self.contract = Some(v);
                self.changed(cx);
            }
            Ok(_) => {
                self.json_error = Some(tr("Falta el objeto «responses»").to_string());
                cx.notify();
            }
            Err(e) => {
                self.json_error = Some(e.to_string());
                cx.notify();
            }
        }
    }

    fn load_history(&mut self, cx: &mut Context<Self>) {
        self.history.clear();
        let Some(id) = self.item_id.clone() else { return };
        let versions = self.app.read(cx).store.contract_versions(&id).unwrap_or_default();
        for v in versions {
            let summary = match (&v.before, &v.after) {
                (None, _) => tr("Contrato creado").to_string(),
                (_, None) => tr("Contrato eliminado").to_string(),
                (b, a) => contracts::diff(b.as_ref(), a.as_ref()).summary_text(),
            };
            let changes = if v.before.is_some() && v.after.is_some() {
                let d = contracts::diff(v.before.as_ref(), v.after.as_ref());
                let mut list: Vec<(bool, String)> = d.changes.iter().map(|c| (c.breaking, c.text())).collect();
                list.sort_by_key(|(b, _)| !*b);
                list
            } else {
                vec![]
            };
            self.history.push(Version { when: v.created_at, summary, changes });
        }
    }

    // ───────────────────────────── Construir filas ─────────────────────────────

    fn input(&mut self, value: String, placeholder: SharedString, window: &mut Window, cx: &mut Context<Self>) -> Entity<InputState> {
        cx.new(|cx| InputState::new(window, cx).placeholder(placeholder).default_value(value))
    }

    fn rebuild(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self._subs.clear();
        self.rows.clear();
        match self.view.clone() {
            View::Request => {
                for (list, title) in
                    [(ParamList::Path, tr("Parámetros de ruta")), (ParamList::Query, tr("Query")), (ParamList::Header, tr("Cabeceras"))]
                {
                    self.rows.push(Row::Section(title));
                    self.param_rows(list, window, cx);
                }
                self.rows.push(Row::Section(tr("Cuerpo")));
                self.body_rows(Target::Request, window, cx);
            }
            View::Response(code) => {
                let desc = self.response(&code).and_then(|r| r.get("description")).and_then(Value::as_str).unwrap_or_default().to_string();
                let input = self.input(desc, tr("Cuándo se devuelve (opcional)"), window, cx);
                let code2 = code.clone();
                self._subs.push(cx.subscribe_in(&input, window, move |this, input, ev: &InputEvent, _, cx| {
                    if matches!(ev, InputEvent::Change) {
                        let v = input.read(cx).value().to_string();
                        if let Some(r) = this.response_mut(&code2) {
                            if v.is_empty() {
                                r.as_object_mut().map(|o| o.remove("description"));
                            } else {
                                r["description"] = json!(v);
                            }
                        }
                        this.changed(cx);
                    }
                }));
                self.rows.push(Row::Description(input));
                self.rows.push(Row::Section(tr("Cabeceras")));
                self.param_rows(ParamList::ResponseHeader, window, cx);
                self.rows.push(Row::Section(tr("Cuerpo")));
                self.body_rows(Target::Response(code), window, cx);
            }
            View::History | View::Json => {}
        }
        cx.notify();
    }

    fn response(&self, code: &str) -> Option<&Value> {
        self.contract.as_ref()?.get("responses")?.get(code)
    }

    fn response_mut(&mut self, code: &str) -> Option<&mut Value> {
        self.contract.as_mut()?.get_mut("responses")?.get_mut(code)
    }

    fn params(&self, list: ParamList) -> Vec<Value> {
        let base = match (&self.view, list) {
            (View::Response(code), ParamList::ResponseHeader) => self.response(code),
            _ => self.contract.as_ref().and_then(|c| c.get("request")),
        };
        base.and_then(|b| b.get(list.key())).and_then(Value::as_array).cloned().unwrap_or_default()
    }

    fn params_mut(&mut self, list: ParamList) -> &mut Vec<Value> {
        let view = self.view.clone();
        let c = self.c();
        let base = match (&view, list) {
            (View::Response(code), ParamList::ResponseHeader) => {
                c["responses"].as_object_mut().unwrap().entry(code.clone()).or_insert_with(|| json!({}))
            }
            _ => {
                let o = c.as_object_mut().unwrap();
                let req = o.entry("request").or_insert_with(|| json!({}));
                if !req.is_object() {
                    *req = json!({});
                }
                req
            }
        };
        let list = base.as_object_mut().unwrap().entry(list.key()).or_insert_with(|| json!([]));
        if !list.is_array() {
            *list = json!([]);
        }
        list.as_array_mut().unwrap()
    }

    fn param_rows(&mut self, list: ParamList, window: &mut Window, cx: &mut Context<Self>) {
        for (ix, p) in self.params(list).iter().enumerate() {
            let name = self.input(p["name"].as_str().unwrap_or_default().to_string(), tr("Nombre"), window, cx);
            let desc = self.input(p["description"].as_str().unwrap_or_default().to_string(), tr("Descripción"), window, cx);
            for (input, is_name) in [(&name, true), (&desc, false)] {
                self._subs.push(cx.subscribe_in(input, window, move |this, input, ev: &InputEvent, _, cx| {
                    if !matches!(ev, InputEvent::Change) {
                        return;
                    }
                    let v = input.read(cx).value().to_string();
                    if let Some(p) = this.params_mut(list).get_mut(ix) {
                        if is_name {
                            p["name"] = json!(v);
                        } else if v.is_empty() {
                            p.as_object_mut().map(|o| o.remove("description"));
                        } else {
                            p["description"] = json!(v);
                        }
                    }
                    this.changed(cx);
                }));
            }
            self.rows.push(Row::Param { list, ix, name, desc });
        }
        if !self.readonly {
            self.rows.push(Row::AddParam(list));
        }
    }

    fn body_schema(&self, target: &Target) -> Option<&Value> {
        match target {
            Target::Request => self.contract.as_ref()?.get("request")?.get("body").filter(|b| !b.is_null()),
            Target::Response(code) => self.response(code)?.get("body").filter(|b| !b.is_null()),
        }
    }

    fn body_schema_mut(&mut self, target: &Target) -> Option<&mut Value> {
        match target {
            Target::Request => self.contract.as_mut()?.get_mut("request")?.get_mut("body"),
            Target::Response(code) => self.response_mut(code)?.get_mut("body"),
        }
    }

    fn body_rows(&mut self, target: Target, window: &mut Window, cx: &mut Context<Self>) {
        let Some(root) = self.body_schema(&target).cloned() else {
            self.rows.push(Row::NoBody(target));
            return;
        };
        self.field_rows(&target, &root, vec![], 0, None, window, cx);
    }

    #[allow(clippy::too_many_arguments)]
    fn field_rows(
        &mut self,
        target: &Target,
        schema: &Value,
        path: Vec<Seg>,
        depth: usize,
        name: Option<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let key = path_key(target, &path);
        let name_input = match name {
            Some(n) => {
                let input = self.input(n, tr("Nombre del campo"), window, cx);
                let (t, p) = (target.clone(), path.clone());
                self._subs.push(cx.subscribe_in(&input, window, move |this, input, ev: &InputEvent, _, cx| {
                    if matches!(ev, InputEvent::Change) {
                        let v = input.read(cx).value().trim().to_string();
                        this.rename_field(&t, &p, v, cx);
                    }
                }));
                Some(input)
            }
            None => None,
        };
        let details = if self.expanded.contains(&key) {
            let (t, _) = main_type(schema);
            let enum_text = schema
                .get("enum")
                .and_then(Value::as_array)
                .map(|a| a.iter().map(|v| show_loose(Some(v))).collect::<Vec<_>>().join(", "))
                .unwrap_or_default();
            let desc = self.input(schema["description"].as_str().unwrap_or_default().to_string(), tr("Descripción"), window, cx);
            let example = self.input(show_loose(schema.get("example")), tr("Ejemplo"), window, cx);
            let values = self.input(enum_text, tr("Valores permitidos, separados por comas"), window, cx);
            for (input, which) in [(&desc, 0u8), (&example, 1), (&values, 2)] {
                let (tg, p, ty) = (target.clone(), path.clone(), t.clone());
                self._subs.push(cx.subscribe_in(input, window, move |this, input, ev: &InputEvent, _, cx| {
                    if !matches!(ev, InputEvent::Change) {
                        return;
                    }
                    let v = input.read(cx).value().to_string();
                    this.edit_field(&tg, &p, cx, |s| {
                        let o = s.as_object_mut().unwrap();
                        match which {
                            0 if v.is_empty() => {
                                o.remove("description");
                            }
                            0 => {
                                o.insert("description".into(), json!(v));
                            }
                            1 => match parse_loose(&v, ty.as_deref()) {
                                Some(x) => {
                                    o.insert("example".into(), x);
                                }
                                None => {
                                    o.remove("example");
                                }
                            },
                            _ => {
                                let numeric = matches!(ty.as_deref(), Some("integer" | "number"));
                                let vals: Vec<Value> = v
                                    .split(',')
                                    .map(str::trim)
                                    .filter(|x| !x.is_empty())
                                    .map(|x| if numeric { serde_json::from_str(x).unwrap_or(json!(x)) } else { json!(x) })
                                    .collect();
                                if vals.is_empty() {
                                    o.remove("enum");
                                } else {
                                    o.insert("enum".into(), Value::Array(vals));
                                }
                            }
                        }
                    });
                }));
            }
            Some(FieldDetails { desc, example, values })
        } else {
            None
        };
        self.rows.push(Row::Field { target: target.clone(), path: path.clone(), depth, name: name_input, details });
        if self.collapsed.contains(&key) {
            return;
        }
        match main_type(schema).0.as_deref() {
            Some("object") => {
                if let Some(props) = schema.get("properties").and_then(Value::as_object) {
                    for (k, v) in props.clone() {
                        let mut p = path.clone();
                        p.push(Seg::Prop(k.clone()));
                        self.field_rows(target, &v, p, depth + 1, Some(k), window, cx);
                    }
                }
                if !self.readonly {
                    self.rows.push(Row::AddField { target: target.clone(), path, depth: depth + 1 });
                }
            }
            Some("array") => {
                let items = schema.get("items").cloned().unwrap_or_else(|| json!({}));
                let mut p = path;
                p.push(Seg::Items);
                self.field_rows(target, &items, p, depth + 1, None, window, cx);
            }
            _ => {}
        }
    }

    // ───────────────────────────── Ediciones ─────────────────────────────

    fn edit_field(&mut self, target: &Target, path: &[Seg], cx: &mut Context<Self>, f: impl FnOnce(&mut Value)) {
        if let Some(root) = self.body_schema_mut(target)
            && let Some(s) = at_mut(root, path)
        {
            if !s.is_object() {
                *s = json!({});
            }
            f(s);
            self.changed(cx);
        }
    }

    /// Cambia el nombre de un campo manteniendo su posición; las filas de debajo actualizan su ruta.
    fn rename_field(&mut self, target: &Target, path: &[Seg], to: String, cx: &mut Context<Self>) {
        let Some(Seg::Prop(from)) = path.last().cloned() else { return };
        if to.is_empty() || to == from {
            return;
        }
        let parent = &path[..path.len() - 1];
        let Some(root) = self.body_schema_mut(target) else { return };
        let Some(obj) = at_mut(root, parent) else { return };
        let Some(props) = obj.get("properties").and_then(Value::as_object) else { return };
        if props.contains_key(&to) {
            return;
        }
        let renamed: Map<String, Value> = props.iter().map(|(k, v)| (if *k == from { to.clone() } else { k.clone() }, v.clone())).collect();
        obj["properties"] = Value::Object(renamed);
        if let Some(req) = obj.get_mut("required").and_then(Value::as_array_mut) {
            for r in req.iter_mut() {
                if r.as_str() == Some(from.as_str()) {
                    *r = json!(to);
                }
            }
        }
        // Las filas de este campo y de sus hijos pasan a la ruta nueva
        let depth = path.len() - 1;
        for row in &mut self.rows {
            if let Row::Field { target: t, path: p, .. } | Row::AddField { target: t, path: p, .. } = row
                && t == target
                && p.len() > depth
                && p[..path.len()] == *path
            {
                p[depth] = Seg::Prop(to.clone());
            }
        }
        self.changed(cx);
    }

    fn set_field_type(&mut self, target: &Target, path: &[Seg], t: String, window: &mut Window, cx: &mut Context<Self>) {
        let Some(root) = self.body_schema_mut(target) else { return };
        if let Some(s) = at_mut(root, path) {
            let (_, nullable) = main_type(s);
            *s = with_type(s, &t, nullable);
        }
        self.rebuild(window, cx);
        self.changed(cx);
    }

    fn set_nullable(&mut self, target: &Target, path: &[Seg], on: bool, window: &mut Window, cx: &mut Context<Self>) {
        let Some(root) = self.body_schema_mut(target) else { return };
        if let Some(s) = at_mut(root, path)
            && let (Some(t), _) = main_type(s)
        {
            *s = with_type(s, &t, on);
        }
        self.rebuild(window, cx);
        self.changed(cx);
    }

    fn set_required(&mut self, target: &Target, path: &[Seg], on: bool, cx: &mut Context<Self>) {
        let Some(Seg::Prop(name)) = path.last().cloned() else { return };
        let parent = path[..path.len() - 1].to_vec();
        self.edit_field(target, &parent, cx, |obj| {
            let req = obj.as_object_mut().unwrap().entry("required").or_insert_with(|| json!([]));
            let arr = req.as_array_mut().unwrap();
            arr.retain(|r| r.as_str() != Some(name.as_str()));
            if on {
                arr.push(json!(name));
            }
        });
        cx.notify();
    }

    fn add_field(&mut self, target: &Target, path: &[Seg], window: &mut Window, cx: &mut Context<Self>) {
        self.edit_field(target, path, cx, |obj| {
            let o = obj.as_object_mut().unwrap();
            let props = o.entry("properties").or_insert_with(|| json!({}));
            // El nombre por defecto sigue el idioma de la interfaz (campo / field)
            let base = tr("campo").to_string();
            let mut key = base.clone();
            let mut i = 1;
            while props.get(&key).is_some() {
                i += 1;
                key = format!("{base}{i}");
            }
            props[&key] = json!({ "type": "string" });
            o.entry("required").or_insert_with(|| json!([])).as_array_mut().unwrap().push(json!(key));
        });
        self.rebuild(window, cx);
    }

    fn remove_field(&mut self, target: &Target, path: &[Seg], window: &mut Window, cx: &mut Context<Self>) {
        let Some(Seg::Prop(name)) = path.last().cloned() else { return };
        let parent = path[..path.len() - 1].to_vec();
        self.edit_field(target, &parent, cx, |obj| {
            if let Some(p) = obj.get_mut("properties").and_then(Value::as_object_mut) {
                p.shift_remove(&name);
            }
            if let Some(r) = obj.get_mut("required").and_then(Value::as_array_mut) {
                r.retain(|x| x.as_str() != Some(name.as_str()));
            }
        });
        self.rebuild(window, cx);
    }

    fn set_body(&mut self, target: &Target, on: bool, window: &mut Window, cx: &mut Context<Self>) {
        let body = on.then(|| json!({ "type": "object", "properties": {}, "required": [] }));
        let c = self.c();
        let holder = match target {
            Target::Request => {
                let o = c.as_object_mut().unwrap().entry("request").or_insert_with(|| json!({}));
                if !o.is_object() {
                    *o = json!({});
                }
                o
            }
            Target::Response(code) => c["responses"].as_object_mut().unwrap().entry(code.clone()).or_insert_with(|| json!({})),
        };
        match body {
            Some(b) => holder["body"] = b,
            None => {
                holder.as_object_mut().map(|o| o.remove("body"));
            }
        }
        self.rebuild(window, cx);
        self.changed(cx);
    }

    fn add_param(&mut self, list: ParamList, window: &mut Window, cx: &mut Context<Self>) {
        let required = list == ParamList::Path;
        self.params_mut(list).push(json!({ "name": "", "required": required, "schema": { "type": "string" } }));
        self.rebuild(window, cx);
        self.changed(cx);
    }

    fn remove_param(&mut self, list: ParamList, ix: usize, window: &mut Window, cx: &mut Context<Self>) {
        let l = self.params_mut(list);
        if ix < l.len() {
            l.remove(ix);
        }
        self.rebuild(window, cx);
        self.changed(cx);
    }

    fn edit_param(&mut self, list: ParamList, ix: usize, cx: &mut Context<Self>, f: impl FnOnce(&mut Value)) {
        if let Some(p) = self.params_mut(list).get_mut(ix) {
            f(p);
        }
        self.changed(cx);
    }

    fn add_code(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let this = cx.entity();
        let suggested = if self.codes().iter().any(|c| c == "200") { "400" } else { "200" };
        crate::ui::dialogs::prompt_text(
            tr("Nuevo código de respuesta"),
            tr("Un código (200, 404…), un rango (4XX) o «default»"),
            suggested.into(),
            tr("Añadir"),
            window,
            cx,
            move |code, window, cx| {
                let valid = code == "default"
                    || (code.len() == 3
                        && code.starts_with(['1', '2', '3', '4', '5'])
                        && (code[1..].chars().all(|c| c.is_ascii_digit()) || code[1..].eq_ignore_ascii_case("XX")));
                if !valid {
                    window.push_notification(
                        gpui_kit::component::notification::Notification::error(trf(
                            "«{code}» no es un código de estado válido",
                            &[("code", &code)],
                        )),
                        cx,
                    );
                    return;
                }
                let code = if code == "default" { code } else { code.to_uppercase() };
                this.update(cx, |t, cx| {
                    let responses = t.c()["responses"].as_object_mut().unwrap();
                    responses
                        .entry(code.clone())
                        .or_insert_with(|| json!({ "body": { "type": "object", "properties": {}, "required": [] } }));
                    t.set_view(View::Response(code), window, cx);
                    t.changed(cx);
                });
            },
        );
    }

    fn remove_code(&mut self, code: &str, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(r) = self.contract.as_mut().and_then(|c| c.get_mut("responses")).and_then(Value::as_object_mut) {
            r.shift_remove(code);
        }
        let first = self.codes().first().cloned();
        self.set_view(first.map(View::Response).unwrap_or(View::Request), window, cx);
        self.changed(cx);
    }

    fn remove_contract(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let this = cx.entity();
        crate::ui::dialogs::confirm(
            tr("Quitar el contrato"),
            tr("Se borran la parte de petición y todas las respuestas. Queda en el historial al guardar."),
            tr("Quitar"),
            window,
            cx,
            move |window, cx| {
                this.update(cx, |t, cx| {
                    t.contract = None;
                    t.set_view(View::Request, window, cx);
                    t.changed(cx);
                })
            },
        );
    }

    // ───────────────────────────── Pintar ─────────────────────────────

    fn render_nav(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let border = cx.theme().border;
        let muted = cx.theme().muted_foreground;
        let active_bg = cx.theme().accent;
        let codes = self.codes();
        let nav = |id: ElementId, active: bool, icon: Option<IconName>, label: SharedString| {
            div()
                .id(id)
                .h_flex()
                .gap_2()
                .px_2()
                .py_1()
                .rounded(px(6.))
                .text_sm()
                .cursor_pointer()
                .when(active, |d| d.bg(active_bg))
                .when_some(icon, |d, i| d.child(Icon::new(i).size_3p5().text_color(muted)))
                .child(label)
        };
        let view = self.view.clone();
        div()
            .v_flex()
            .w(px(224.))
            .flex_shrink_0()
            .h_full()
            .border_r_1()
            .border_color(border)
            .p_2()
            .gap_0p5()
            .child(
                nav("ct-request".into(), view == View::Request, Some(IconName::ArrowUp), tr("Petición"))
                    .on_click(cx.listener(|this, _, window, cx| this.set_view(View::Request, window, cx))),
            )
            .child(div().px_2().pt_3().pb_1().text_xs().text_color(muted).child(tr("Respuestas")))
            .children(codes.into_iter().enumerate().map(|(ix, code)| {
                let desc = self.response(&code).and_then(|r| r.get("description")).and_then(Value::as_str).unwrap_or_default().to_string();
                let color = crate::theme::status_color(code[..1].parse::<u16>().unwrap_or(0) * 100, cx);
                let active = view == View::Response(code.clone());
                let c2 = code.clone();
                div()
                    .id(("ct-code", ix))
                    .h_flex()
                    .gap_2()
                    .px_2()
                    .py_1()
                    .rounded(px(6.))
                    .text_sm()
                    .cursor_pointer()
                    .when(active, |d| d.bg(active_bg))
                    .child(div().font_semibold().text_color(color).child(code))
                    .child(div().text_color(muted).truncate().child(desc))
                    .on_click(cx.listener(move |this, _, window, cx| this.set_view(View::Response(c2.clone()), window, cx)))
            }))
            .when(!self.readonly, |d| {
                d.child(
                    div().h_flex().child(
                        Button::new("ct-add-code")
                            .ghost()
                            .small()
                            .icon(IconName::Plus)
                            .label(tr("Código de respuesta"))
                            .on_click(cx.listener(|this, _, window, cx| this.add_code(window, cx))),
                    ),
                )
            })
            .child(div().flex_1())
            .child(div().border_t_1().border_color(border).my_1())
            .when(self.item_id.is_some(), |d| {
                d.child(
                    nav("ct-history".into(), view == View::History, Some(IconName::Undo2), tr("Historial"))
                        .on_click(cx.listener(|this, _, window, cx| this.set_view(View::History, window, cx))),
                )
            })
            .child(
                nav("ct-json".into(), view == View::Json, Some(IconName::Braces), tr("Ver como JSON Schema"))
                    .on_click(cx.listener(|this, _, window, cx| this.set_view(View::Json, window, cx))),
            )
            .when(!self.readonly, |d| {
                d.child(
                    div()
                        .id("ct-remove")
                        .h_flex()
                        .gap_2()
                        .px_2()
                        .py_1()
                        .text_sm()
                        .cursor_pointer()
                        .text_color(cx.theme().danger)
                        .child(Icon::new(IconName::Trash).size_3p5())
                        .child(tr("Quitar el contrato"))
                        .on_click(cx.listener(|this, _, window, cx| this.remove_contract(window, cx))),
                )
            })
    }

    fn render_empty(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let has_last = self.last.is_some();
        div()
            .v_flex()
            .size_full()
            .items_center()
            .justify_center()
            .gap_3()
            .p_6()
            .child(empty_state(
                IconName::FileCheck,
                tr("Sin contrato"),
                tr("El contrato fija lo que envía el frontend y lo que debe devolver el backend en cada código. Cartero lo comprueba al enviar la petición y el mock responde con datos que lo cumplen."),
                cx,
            ))
            .when(!self.readonly, |d| {
                d.child(
                    div()
                        .h_flex()
                        .gap_2()
                        .when(has_last, |d| {
                            d.child(
                                Button::new("ct-generate")
                                    .primary()
                                    .small()
                                    .icon(IconName::WandSparkles)
                                    .label(tr("Generar desde la última respuesta"))
                                    .on_click(cx.listener(|_, _, _, cx| cx.emit(ContractEvent::Generate))),
                            )
                        })
                        .child(
                            Button::new("ct-blank")
                                .outline()
                                .small()
                                .icon(IconName::Plus)
                                .label(tr("Empezar en blanco"))
                                .on_click(cx.listener(|_, _, _, cx| cx.emit(ContractEvent::StartBlank))),
                        )
                        .when(self.item_id.is_some(), |d| {
                            d.child(
                                Button::new("ct-empty-history")
                                    .ghost()
                                    .small()
                                    .icon(IconName::Undo2)
                                    .label(tr("Historial"))
                                    .on_click(cx.listener(|this, _, window, cx| this.set_view(View::History, window, cx))),
                            )
                        }),
                )
            })
            .into_any_element()
    }

    fn render_history(&self, cx: &App) -> AnyElement {
        let muted = cx.theme().muted_foreground;
        let border = cx.theme().border;
        if self.history.is_empty() {
            return div().p_4().text_sm().text_color(muted).child(tr("El contrato aún no tiene versiones guardadas.")).into_any_element();
        }
        div()
            .v_flex()
            .gap_2()
            .p_3()
            .children(self.history.iter().map(|v| {
                div()
                    .v_flex()
                    .gap_1()
                    .p_2()
                    .border_1()
                    .border_color(border)
                    .rounded(cx.theme().radius)
                    .child(
                        div()
                            .h_flex()
                            .justify_between()
                            .child(div().text_sm().font_semibold().child(v.summary.clone()))
                            .child(div().text_xs().text_color(muted).child(relative_time(&v.when))),
                    )
                    .children(v.changes.iter().map(|(breaking, text)| change_row(*breaking, text.clone(), cx)))
            }))
            .into_any_element()
    }

    fn render_rows(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let muted = cx.theme().muted_foreground;
        let border = cx.theme().border;
        let readonly = self.readonly;
        let mut out: Vec<AnyElement> = vec![];
        // Cabecera de la vista
        match self.view.clone() {
            View::Request => out.push(
                div()
                    .h_flex()
                    .justify_between()
                    .gap_3()
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .text_sm()
                            .text_color(muted)
                            .child(tr("Lo que debe enviar el frontend. Cartero avisa al enviar si la petición no lo cumple.")),
                    )
                    .when(!readonly, |d| {
                        d.child(
                            Button::new("ct-fill")
                                .outline()
                                .small()
                                .icon(IconName::WandSparkles)
                                .label(tr("Completar con la petición actual"))
                                .on_click(cx.listener(|_, _, _, cx| cx.emit(ContractEvent::FillFromRequest))),
                        )
                    })
                    .into_any_element(),
            ),
            View::Response(code) => {
                let color = crate::theme::status_color(code[..1].parse::<u16>().unwrap_or(0) * 100, cx);
                let can_generate = self.last.as_ref().is_some_and(|l| l.code.to_string() == code);
                let c2 = code.clone();
                out.push(
                    div()
                        .h_flex()
                        .gap_2()
                        .child(div().font_semibold().text_color(color).child(code.clone()))
                        .child(div().flex_1().min_w_0().children(self.rows.iter().find_map(|r| match r {
                            Row::Description(i) => Some(Input::new(i).small().disabled(readonly)),
                            _ => None,
                        })))
                        .when(!readonly && can_generate, |d| {
                            d.child(
                                Button::new("ct-generate-code")
                                    .outline()
                                    .small()
                                    .icon(IconName::WandSparkles)
                                    .label(tr("Generar desde la última respuesta"))
                                    .on_click(cx.listener(|_, _, _, cx| cx.emit(ContractEvent::Generate))),
                            )
                        })
                        .when(!readonly, |d| {
                            d.child(
                                Button::new("ct-remove-code")
                                    .ghost()
                                    .small()
                                    .icon(IconName::Trash)
                                    .label(tr("Quitar código"))
                                    .on_click(cx.listener(move |this, _, window, cx| this.remove_code(&c2, window, cx))),
                            )
                        })
                        .into_any_element(),
                );
            }
            _ => {}
        }

        let entity = cx.entity();
        for (ix, row) in self.rows.iter().enumerate() {
            let el = match row {
                Row::Description(_) => continue,
                Row::Section(title) => {
                    let target = match &self.view {
                        View::Response(c) => Target::Response(c.clone()),
                        _ => Target::Request,
                    };
                    let is_body = *title == tr("Cuerpo");
                    let has_body = self.body_schema(&target).is_some();
                    div()
                        .h_flex()
                        .justify_between()
                        .pt_3()
                        .pb_1()
                        .child(div().text_xs().font_semibold().text_color(muted).child(title.clone()))
                        .when(is_body && !readonly, |d| {
                            d.child(
                                Button::new(("ct-body-toggle", ix))
                                    .ghost()
                                    .xsmall()
                                    .when(!has_body, |b| b.icon(IconName::Plus))
                                    .label(if has_body { tr("Sin cuerpo") } else { tr("Definir cuerpo") })
                                    .on_click(cx.listener(move |this, _, window, cx| this.set_body(&target, !has_body, window, cx))),
                            )
                        })
                        .into_any_element()
                }
                Row::NoBody(target) => div()
                    .text_sm()
                    .text_color(muted)
                    .child(if *target == Target::Request {
                        tr("Esta petición no lleva cuerpo en el contrato.")
                    } else {
                        tr("Esta respuesta no lleva cuerpo (por ejemplo, un 204).")
                    })
                    .into_any_element(),
                Row::AddParam(list) => {
                    let list = *list;
                    div()
                        .h_flex()
                        .child(
                            Button::new(("ct-add-param", ix))
                                .ghost()
                                .xsmall()
                                .icon(IconName::Plus)
                                .label(if matches!(list, ParamList::Header | ParamList::ResponseHeader) {
                                    tr("Cabecera")
                                } else {
                                    tr("Parámetro")
                                })
                                .on_click(cx.listener(move |this, _, window, cx| this.add_param(list, window, cx))),
                        )
                        .into_any_element()
                }
                Row::Param { list, ix: pix, name, desc } => {
                    let (list, pix) = (*list, *pix);
                    let p = self.params(list).get(pix).cloned().unwrap_or_default();
                    let t = p.get("schema").map(main_type).and_then(|(t, _)| t).unwrap_or_else(|| "string".into());
                    let required = list == ParamList::Path || p["required"].as_bool().unwrap_or(false);
                    let e2 = entity.clone();
                    div()
                        .h_flex()
                        .gap_2()
                        .py_0p5()
                        .border_b_1()
                        .border_color(border)
                        .child(div().w(px(176.)).flex_shrink_0().child(Input::new(name).small().disabled(readonly)))
                        .child(choice(("ct-param-type", ix), &t, type_options(), move |v: String, _, cx| {
                            e2.update(cx, |this, cx| {
                                this.edit_param(list, pix, cx, |p| p["schema"] = json!({ "type": v }));
                                cx.notify();
                            })
                        }))
                        .child(
                            Checkbox::new(("ct-param-req", ix))
                                .checked(required)
                                .small()
                                .label(tr("Obligatorio"))
                                .disabled(readonly || list == ParamList::Path)
                                .on_click(cx.listener(move |this, on: &bool, _, cx| {
                                    let on = *on;
                                    this.edit_param(list, pix, cx, |p| p["required"] = json!(on));
                                })),
                        )
                        .child(div().flex_1().min_w_0().child(Input::new(desc).small().disabled(readonly)))
                        .when(!readonly, |d| {
                            d.child(
                                Button::new(("ct-param-del", ix))
                                    .ghost()
                                    .xsmall()
                                    .icon(IconName::X)
                                    .tooltip(tr("Quitar"))
                                    .on_click(cx.listener(move |this, _, window, cx| this.remove_param(list, pix, window, cx))),
                            )
                        })
                        .into_any_element()
                }
                Row::AddField { target, path, depth } => {
                    let (t, p) = (target.clone(), path.clone());
                    div()
                        .h_flex()
                        .pl(px(30. + *depth as f32 * 18.))
                        .child(
                            Button::new(("ct-add-field", ix))
                                .ghost()
                                .xsmall()
                                .icon(IconName::Plus)
                                .label(tr("Campo"))
                                .on_click(cx.listener(move |this, _, window, cx| this.add_field(&t, &p, window, cx))),
                        )
                        .into_any_element()
                }
                Row::Field { target, path, depth, name, details } => {
                    self.render_field(ix, target, path, *depth, name.as_ref(), details.as_ref(), entity.clone(), cx)
                }
            };
            out.push(el);
        }
        div().v_flex().gap_0p5().p_3().children(out).into_any_element()
    }

    #[allow(clippy::too_many_arguments)]
    fn render_field(
        &self,
        ix: usize,
        target: &Target,
        path: &[Seg],
        depth: usize,
        name: Option<&Entity<InputState>>,
        details: Option<&FieldDetails>,
        entity: Entity<Self>,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let muted = cx.theme().muted_foreground;
        let border = cx.theme().border;
        let readonly = self.readonly;
        let root = self.body_schema(target).cloned().unwrap_or(Value::Null);
        let schema = at(&root, path).cloned().unwrap_or_else(|| json!({}));
        let (t, nullable) = main_type(&schema);
        let key = path_key(target, path);
        let has_children = matches!(t.as_deref(), Some("object" | "array"));
        let collapsed = self.collapsed.contains(&key);
        let is_items = path.last() == Some(&Seg::Items);
        let is_prop = matches!(path.last(), Some(Seg::Prop(_)));
        let required = match path.last() {
            Some(Seg::Prop(n)) => {
                let parent = at(&root, &path[..path.len() - 1]);
                parent.and_then(|p| p.get("required")).and_then(Value::as_array).is_some_and(|r| r.iter().any(|x| x.as_str() == Some(n)))
            }
            _ => false,
        };
        let summary = [
            schema.get("format").and_then(Value::as_str).map(str::to_string),
            schema.get("enum").and_then(Value::as_array).map(|a| trf("{n} valores", &[("n", &a.len().to_string())]).to_string()),
            schema.get("description").and_then(Value::as_str).map(str::to_string),
        ]
        .into_iter()
        .flatten()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" · ");

        let (t1, p1) = (target.clone(), path.to_vec());
        let (t2, p2) = (target.clone(), path.to_vec());
        let (t3, p3) = (target.clone(), path.to_vec());
        let (t4, p4) = (target.clone(), path.to_vec());
        let (k1, k2) = (key.clone(), key.clone());
        let e_type = entity.clone();
        let tcur = t.clone().unwrap_or_default();
        let main = div()
            .h_flex()
            .gap_1p5()
            .py_0p5()
            .pr_1()
            .pl(px(4. + depth as f32 * 18.))
            .border_b_1()
            .border_color(border)
            .child(div().id(("ct-fold", ix)).size_4().flex_shrink_0().flex().items_center().justify_center().text_color(muted).when(
                has_children,
                |d| {
                    d.cursor_pointer()
                        .child(Icon::new(if collapsed { IconName::ChevronRight } else { IconName::ChevronDown }).size_3p5())
                        .on_click(cx.listener(move |this, _, window, cx| {
                            if !this.collapsed.remove(&k1) {
                                this.collapsed.insert(k1.clone());
                            }
                            this.rebuild(window, cx);
                        }))
                },
            ))
            .child(div().w(px(176.)).flex_shrink_0().map(|d| match name {
                Some(input) => d.child(Input::new(input).small().disabled(readonly)),
                None if is_items => d.text_xs().text_color(muted).child(tr("cada elemento")),
                None => d.text_xs().font_semibold().text_color(muted).child(tr("Cuerpo")),
            }))
            .child(choice(("ct-type", ix), &tcur, type_options(), move |v: String, window, cx| {
                let (t, p) = (t1.clone(), p1.clone());
                e_type.update(cx, |this, cx| this.set_field_type(&t, &p, v, window, cx))
            }))
            .child(div().w(px(104.)).flex_shrink_0().when(is_prop, |d| {
                d.child(
                    Checkbox::new(("ct-req", ix))
                        .checked(required)
                        .small()
                        .label(tr("Obligatorio"))
                        .disabled(readonly)
                        .on_click(cx.listener(move |this, on: &bool, _, cx| this.set_required(&t2, &p2, *on, cx))),
                )
            }))
            .when(t.as_deref().is_some_and(|t| t != "null"), |d| {
                d.child(
                    Checkbox::new(("ct-null", ix))
                        .checked(nullable)
                        .small()
                        .label(tr("Puede ser nulo"))
                        .disabled(readonly)
                        .on_click(cx.listener(move |this, on: &bool, window, cx| this.set_nullable(&t3, &p3, *on, window, cx))),
                )
            })
            .child(div().flex_1().min_w_0().pl_2().text_xs().text_color(muted).truncate().child(summary))
            .child(
                Button::new(("ct-details", ix))
                    .ghost()
                    .xsmall()
                    .icon(IconName::SlidersHorizontal)
                    .tooltip(tr("Más detalles"))
                    .selected(details.is_some())
                    .on_click(cx.listener(move |this, _, window, cx| {
                        if !this.expanded.remove(&k2) {
                            this.expanded.insert(k2.clone());
                        }
                        this.rebuild(window, cx);
                    })),
            )
            .when(is_prop && !readonly, |d| {
                d.child(
                    Button::new(("ct-del", ix))
                        .ghost()
                        .xsmall()
                        .icon(IconName::X)
                        .tooltip(tr("Quitar campo"))
                        .on_click(cx.listener(move |this, _, window, cx| this.remove_field(&t4, &p4, window, cx))),
                )
            });

        let Some(det) = details else { return main.into_any_element() };
        let is_string = t.as_deref() == Some("string");
        let has_values = matches!(t.as_deref(), Some("string" | "integer" | "number"));
        let format = schema.get("format").and_then(Value::as_str).unwrap_or_default().to_string();
        let (t5, p5) = (target.clone(), path.to_vec());
        let e_fmt = entity;
        let formats: Vec<(SharedString, String)> =
            FORMATS.iter().map(|f| (if f.is_empty() { tr("Sin formato") } else { SharedString::from(*f) }, f.to_string())).collect();
        div()
            .v_flex()
            .child(main)
            .child(
                div()
                    .h_flex()
                    .flex_wrap()
                    .gap_2()
                    .py_1p5()
                    .pr_2()
                    .pl(px(26. + depth as f32 * 18.))
                    .bg(cx.theme().muted)
                    .border_b_1()
                    .border_color(border)
                    .child(div().w(px(220.)).child(Input::new(&det.desc).small().disabled(readonly)))
                    .child(div().w(px(160.)).child(Input::new(&det.example).small().disabled(readonly)))
                    .when(is_string, |d| {
                        d.child(choice(("ct-format", ix), &format, formats, move |v: String, _, cx| {
                            let (t, p) = (t5.clone(), p5.clone());
                            e_fmt.update(cx, |this, cx| {
                                this.edit_field(&t, &p, cx, |s| {
                                    let o = s.as_object_mut().unwrap();
                                    if v.is_empty() {
                                        o.remove("format");
                                    } else {
                                        o.insert("format".into(), json!(v));
                                    }
                                })
                            })
                        }))
                    })
                    .when(has_values, |d| d.child(div().w(px(260.)).child(Input::new(&det.values).small().disabled(readonly)))),
            )
            .into_any_element()
    }
}

/// Una línea de cambio: «Rompe» en rojo o «Compatible» en verde, y el texto.
pub fn change_row(breaking: bool, text: String, cx: &App) -> impl IntoElement {
    let color = if breaking { cx.theme().danger } else { crate::theme::status_color(200, cx) };
    div()
        .h_flex()
        .gap_2()
        .px_2()
        .py_1()
        .rounded(px(4.))
        .border_l_2()
        .border_color(color)
        .bg(color.opacity(0.06))
        .text_sm()
        .child(div().flex_shrink_0().text_xs().font_semibold().text_color(color).child(if breaking {
            tr("Rompe")
        } else {
            tr("Compatible")
        }))
        .child(div().min_w_0().child(text))
}

impl Render for ContractEditor {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.contract.is_none() && !matches!(self.view, View::History | View::Json) {
            return self.render_empty(cx);
        }
        let body = match self.view {
            View::History => div().id("ct-body").size_full().overflow_y_scroll().child(self.render_history(cx)).into_any_element(),
            View::Json => {
                let muted = cx.theme().muted_foreground;
                let (msg, color) = match &self.json_error {
                    Some(e) => (SharedString::from(e.clone()), cx.theme().danger),
                    None => (tr("Cada respuesta lleva su JSON Schema (draft 2020-12, el de OpenAPI 3.1)."), muted),
                };
                div()
                    .v_flex()
                    .size_full()
                    .child(div().px_3().py_1p5().text_xs().text_color(color).border_b_1().border_color(cx.theme().border).child(msg))
                    .child(div().flex_1().min_h_0().child(Editor::new(&self.json).h_full()))
                    .into_any_element()
            }
            _ => div().id("ct-body").size_full().overflow_y_scroll().child(self.render_rows(cx)).into_any_element(),
        };
        div().h_flex().size_full().child(self.render_nav(cx)).child(div().flex_1().min_w_0().h_full().child(body)).into_any_element()
    }
}
