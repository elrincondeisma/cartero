//! Pestaña de petición: método, URL, parámetros, auth, cabeceras, cuerpo, scripts y
//! descripción, con la respuesta debajo.

use cartero_model::{Body, FormParam, Item, KeyValue, QueryParam, Request, Url, Variable, script_of, set_script};
use cartero_runner::{ExecOptions, Outcome};
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::input::{Editor, EditorState, Input, InputEvent, InputState};
use gpui_kit::component::menu::{DropdownMenu as _, PopupMenuItem};
use gpui_kit::component::notification::Notification;
use gpui_kit::component::tab::{Tab, TabBar};
use gpui_kit::component::{h_resizable, resizable_panel, v_resizable};
use serde_json::Value;

use crate::state::{AppState, StateEvent};
use crate::ui::auth::{AuthChanged, AuthEditor};
use crate::ui::kv::{FlagKind, KvChanged, KvEditor, KvItem, KvOptions};
use crate::ui::prelude::*;
use crate::ui::response::ResponseView;
use crate::ui::widgets::choice;

pub const METHODS: [&str; 7] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

#[derive(Clone, Copy, PartialEq, Eq)]
enum Section {
    Params,
    Auth,
    Headers,
    Body,
    Scripts,
    Docs,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ScriptKind {
    Pre,
    Post,
}

pub enum TabEvent {
    /// Ha cambiado el título, el método o si hay cambios sin guardar
    Changed,
}

pub struct RequestTab {
    pub app: Entity<AppState>,
    pub collection_id: Option<String>,
    pub item_id: Option<String>,
    base: Item,
    pub name: String,
    pub method: String,
    pub dirty: bool,
    section: Section,
    script_kind: ScriptKind,
    url: Entity<InputState>,
    params: Entity<KvEditor>,
    path_vars: Entity<KvEditor>,
    headers: Entity<KvEditor>,
    body_mode: String,
    raw_lang: String,
    raw: Entity<EditorState>,
    urlencoded: Entity<KvEditor>,
    formdata: Entity<KvEditor>,
    file_path: Option<String>,
    gql_query: Entity<EditorState>,
    gql_vars: Entity<EditorState>,
    auth: Entity<AuthEditor>,
    pre: Entity<EditorState>,
    post: Entity<EditorState>,
    docs: Entity<EditorState>,
    pub response: Entity<ResponseView>,
    sending: Option<tokio::task::AbortHandle>,
    focus: FocusHandle,
    syncing: bool,
    _subs: Vec<Subscription>,
}

impl EventEmitter<TabEvent> for RequestTab {}

fn editor(lang: &str, value: String, window: &mut Window, cx: &mut App) -> Entity<EditorState> {
    let lang = lang.to_string();
    cx.new(|cx| EditorState::new(window, cx).language(lang).line_number(true).soft_wrap(true).default_value(value))
}

fn kv_from_headers(list: &[KeyValue]) -> Vec<KvItem> {
    list.iter()
        .map(|h| KvItem {
            key: h.key.clone(),
            value: h.value.clone(),
            description: cartero_model::description_text(&h.description),
            enabled: !h.disabled,
            flag: false,
        })
        .collect()
}

fn kv_to_headers(items: Vec<KvItem>, base: &[KeyValue]) -> Vec<KeyValue> {
    items
        .into_iter()
        .map(|i| {
            let mut kv = base.iter().find(|b| b.key == i.key).cloned().unwrap_or_default();
            kv.key = i.key;
            kv.value = i.value;
            kv.disabled = !i.enabled;
            kv.description = (!i.description.is_empty()).then(|| Value::String(i.description));
            kv
        })
        .collect()
}

fn raw_language_for_editor(lang: &str) -> &'static str {
    match lang {
        "json" => "json",
        "xml" | "html" => "html",
        "javascript" => "javascript",
        _ => "text",
    }
}

impl RequestTab {
    pub fn new(app: Entity<AppState>, collection_id: Option<String>, item: Item, saved: bool, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let req = item.request.clone().unwrap_or_default();
        let url_raw = req.url.raw();
        let url = cx.new(|cx| InputState::new(window, cx).placeholder(tr("Escribe una URL o pega un comando cURL")).default_value(url_raw.clone()));
        let query: Vec<KvItem> = match &req.url {
            Url::Parts(p) => p
                .query
                .iter()
                .flatten()
                .map(|q| KvItem {
                    key: q.key.clone().unwrap_or_default(),
                    value: q.value.clone().unwrap_or_default(),
                    description: cartero_model::description_text(&q.description),
                    enabled: !q.disabled,
                    flag: false,
                })
                .collect(),
            Url::Raw(s) => cartero_model::url::parse(s).query.unwrap_or_default().into_iter().map(|q| KvItem::new(q.key.unwrap_or_default(), q.value.unwrap_or_default())).collect(),
        };
        let path: Vec<KvItem> = req.url.path_variables().iter().map(|v| KvItem { key: v.key.clone(), value: v.value_str(), description: cartero_model::description_text(&v.description), enabled: true, flag: false }).collect();
        let params = cx.new(|cx| KvEditor::new(query, KvOptions::default(), window, cx));
        let path_vars = cx.new(|cx| KvEditor::new(path, KvOptions { checkbox: false, ..Default::default() }, window, cx).readonly(false));
        let headers = cx.new(|cx| KvEditor::new(kv_from_headers(req.headers()), KvOptions::default(), window, cx));
        let body = req.body.clone().unwrap_or_default();
        let body_mode = body.mode().to_string();
        let raw_lang = body.raw_language().to_string();
        let raw = editor(raw_language_for_editor(&raw_lang), body.raw.clone().unwrap_or_default(), window, cx);
        let urlencoded = cx.new(|cx| KvEditor::new(kv_from_headers(body.urlencoded.as_deref().unwrap_or_default()), KvOptions::default(), window, cx));
        let form_items: Vec<KvItem> = body
            .formdata
            .iter()
            .flatten()
            .map(|f| KvItem {
                key: f.key.clone(),
                value: if f.is_file() { f.files().join(", ") } else { f.value.clone().unwrap_or_default() },
                description: cartero_model::description_text(&f.description),
                enabled: !f.disabled,
                flag: f.is_file(),
            })
            .collect();
        let formdata = cx.new(|cx| KvEditor::new(form_items, KvOptions { flag: FlagKind::File, ..Default::default() }, window, cx));
        let gql = body.graphql.clone().unwrap_or_default();
        let gql_query = editor("text", gql["query"].as_str().unwrap_or_default().to_string(), window, cx);
        let gql_vars = editor("json", gql["variables"].as_str().unwrap_or_default().to_string(), window, cx);
        let auth_value = req.auth.clone().flatten().filter(|a| !a.is_inherit());
        let auth = cx.new(|cx| AuthEditor::new(app.clone(), collection_id.clone(), auth_value, true, window, cx));
        let pre = editor("javascript", script_of(&item.event, "prerequest").unwrap_or_default(), window, cx);
        let post = editor("javascript", script_of(&item.event, "test").unwrap_or_default(), window, cx);
        let docs = editor("text", cartero_model::description_text(&req.description), window, cx);
        let response = cx.new(|cx| ResponseView::new(window, cx));
        let limit = app.read(cx).settings.highlight_limit_kb;
        response.update(cx, |r, _| r.set_highlight_limit(limit));
        let section = if body_mode != "none" { Section::Body } else { Section::Params };
        let mut this = Self {
            app: app.clone(),
            collection_id,
            item_id: saved.then(|| item.id().to_string()),
            name: item.name.clone(),
            method: req.method.to_uppercase(),
            base: item,
            dirty: false,
            section,
            script_kind: ScriptKind::Post,
            url,
            params,
            path_vars,
            headers,
            body_mode,
            raw_lang,
            raw,
            urlencoded,
            formdata,
            file_path: body.file_src(),
            gql_query,
            gql_vars,
            auth,
            pre,
            post,
            docs,
            response,
            sending: None,
            focus: cx.focus_handle(),
            syncing: false,
            _subs: vec![],
        };
        this.subscribe(window, cx);
        this.refresh_inherited(cx);
        this
    }

    fn subscribe(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let url = self.url.clone();
        self._subs.push(cx.subscribe_in(&url, window, |this, _, ev: &InputEvent, window, cx| match ev {
            InputEvent::Change => this.on_url_change(window, cx),
            InputEvent::PressEnter { .. } => this.send(window, cx),
            _ => {}
        }));
        let params = self.params.clone();
        self._subs.push(cx.subscribe_in(&params, window, |this, _, _: &KvChanged, window, cx| this.on_params_change(window, cx)));
        for kv in [self.path_vars.clone(), self.headers.clone(), self.urlencoded.clone(), self.formdata.clone()] {
            self._subs.push(cx.subscribe_in(&kv, window, |this, _, _: &KvChanged, _, cx| this.mark_dirty(cx)));
        }
        for ed in [self.raw.clone(), self.gql_query.clone(), self.gql_vars.clone(), self.pre.clone(), self.post.clone(), self.docs.clone()] {
            self._subs.push(cx.subscribe_in(&ed, window, |this, _, ev: &InputEvent, _, cx| {
                if matches!(ev, InputEvent::Change) {
                    this.mark_dirty(cx)
                }
            }));
        }
        let auth = self.auth.clone();
        self._subs.push(cx.subscribe_in(&auth, window, |this, _, _: &AuthChanged, _, cx| this.mark_dirty(cx)));
        let app = self.app.clone();
        self._subs.push(cx.subscribe_in(&app, window, |this, _, ev: &StateEvent, window, cx| match ev {
            StateEvent::Collections => this.refresh_inherited(cx),
            StateEvent::ItemChanged(id) if this.item_id.as_deref() == Some(id.as_str()) && !this.dirty => this.reload(window, cx),
            StateEvent::Environments => cx.notify(),
            StateEvent::RemoteChanged if !this.dirty => {
                if let Some(id) = this.item_id.clone()
                    && let Ok(item) = this.app.read(cx).store.item(&id)
                    && item != this.base
                {
                    this.load_item(item, window, cx);
                }
            }
            _ => {}
        }));
    }

    pub fn focus_handle(&self) -> &FocusHandle {
        &self.focus
    }

    pub fn focus_url(&self, window: &mut Window, cx: &mut App) {
        self.url.update(cx, |s, cx| s.focus(window, cx));
    }

    fn mark_dirty(&mut self, cx: &mut Context<Self>) {
        if self.syncing {
            return;
        }
        if !self.dirty {
            self.dirty = true;
            cx.emit(TabEvent::Changed);
        }
        cx.notify();
    }

    /// Origen de la auth heredada, para explicarlo en la pestaña Autorización.
    fn refresh_inherited(&mut self, cx: &mut Context<Self>) {
        let from = self.item_id.as_ref().and_then(|id| {
            let app = self.app.read(cx);
            let c = self.collection_id.as_ref().and_then(|cid| app.trees.get(cid))?;
            let mut c = c.clone();
            if let Some(it) = cartero_model::tree::find_mut(&mut c.item, id)
                && let Some(r) = it.request.as_mut()
            {
                r.auth = None;
            }
            cartero_model::tree::effective_auth(&c, id).map(|(a, from)| SharedString::from(format!("«{from}» ({})", a.kind)))
        });
        self.auth.update(cx, |a, cx| a.set_inherited(from, cx));
    }

    fn on_url_change(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let raw = self.url.read(cx).value().to_string();
        // Pegar un cURL en la barra de la URL lo convierte en la petición
        if cartero_model::import::curl::is_curl(&raw)
            && let Ok(req) = cartero_model::import::curl::parse(&raw)
        {
            let mut item = self.build_item(cx);
            item.request = Some(req);
            self.load_item(item, window, cx);
            self.mark_dirty(cx);
            window.push_notification(Notification::success(tr("Comando cURL importado")), cx);
            return;
        }
        if self.syncing {
            return;
        }
        let parsed = cartero_model::url::parse(&raw);
        let disabled: Vec<KvItem> = self.params.read(cx).items(cx).into_iter().filter(|i| !i.enabled).collect();
        let current: Vec<KvItem> = self.params.read(cx).items(cx);
        let mut items: Vec<KvItem> = parsed
            .query
            .unwrap_or_default()
            .into_iter()
            .map(|q| {
                let key = q.key.unwrap_or_default();
                let description = current.iter().find(|c| c.key == key && c.enabled).map(|c| c.description.clone()).unwrap_or_default();
                KvItem { key, value: q.value.unwrap_or_default(), description, enabled: true, flag: false }
            })
            .collect();
        items.extend(disabled);
        self.syncing = true;
        self.params.update(cx, |p, cx| p.set_items(items, window, cx));
        // Variables de ruta (:id)
        let old: Vec<KvItem> = self.path_vars.read(cx).items(cx);
        let vars: Vec<KvItem> = parsed
            .variable
            .unwrap_or_default()
            .into_iter()
            .map(|v| old.iter().find(|o| o.key == v.key).cloned().unwrap_or_else(|| KvItem::new(v.key, "")))
            .collect();
        if vars.iter().map(|v| &v.key).ne(old.iter().map(|v| &v.key)) {
            self.path_vars.update(cx, |p, cx| p.set_items(vars, window, cx));
        }
        self.syncing = false;
        self.mark_dirty(cx);
    }

    fn on_params_change(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.syncing {
            return;
        }
        let raw = self.url.read(cx).value().to_string();
        let (base, hash) = match raw.split_once('#') {
            Some((b, h)) => (b.to_string(), Some(h.to_string())),
            None => (raw.clone(), None),
        };
        let base = base.split('?').next().unwrap_or_default().to_string();
        let qs: Vec<String> = self
            .params
            .read(cx)
            .items(cx)
            .into_iter()
            .filter(|i| i.enabled && !i.key.is_empty())
            .map(|i| if i.value.is_empty() { i.key } else { format!("{}={}", i.key, i.value) })
            .collect();
        let mut next = base;
        if !qs.is_empty() {
            next.push('?');
            next.push_str(&qs.join("&"));
        }
        if let Some(h) = hash {
            next.push('#');
            next.push_str(&h);
        }
        self.syncing = true;
        self.url.update(cx, |s, cx| s.set_value(next, window, cx));
        self.syncing = false;
        self.mark_dirty(cx);
    }

    /// Carga un ítem en los editores (al abrir, al recargar o al pegar un cURL).
    fn load_item(&mut self, item: Item, window: &mut Window, cx: &mut Context<Self>) {
        let req = item.request.clone().unwrap_or_default();
        self.syncing = true;
        self.method = req.method.to_uppercase();
        let raw = req.url.raw();
        self.url.update(cx, |s, cx| s.set_value(raw.clone(), window, cx));
        let parts = match &req.url {
            Url::Parts(p) => p.clone(),
            Url::Raw(s) => cartero_model::url::parse(s),
        };
        let query = parts.query.iter().flatten().map(|q| KvItem { key: q.key.clone().unwrap_or_default(), value: q.value.clone().unwrap_or_default(), description: cartero_model::description_text(&q.description), enabled: !q.disabled, flag: false }).collect();
        self.params.update(cx, |p, cx| p.set_items(query, window, cx));
        let path = parts.variable.iter().flatten().map(|v| KvItem { key: v.key.clone(), value: v.value_str(), description: String::new(), enabled: true, flag: false }).collect();
        self.path_vars.update(cx, |p, cx| p.set_items(path, window, cx));
        self.headers.update(cx, |p, cx| p.set_items(kv_from_headers(req.headers()), window, cx));
        let body = req.body.clone().unwrap_or_default();
        self.body_mode = body.mode().to_string();
        self.raw_lang = body.raw_language().to_string();
        let raw_body = body.raw.clone().unwrap_or_default();
        let lang = raw_language_for_editor(&self.raw_lang);
        self.raw.update(cx, |s, cx| {
            s.set_highlighter(lang, cx);
            s.set_value(raw_body, window, cx)
        });
        self.urlencoded.update(cx, |p, cx| p.set_items(kv_from_headers(body.urlencoded.as_deref().unwrap_or_default()), window, cx));
        let form = body.formdata.iter().flatten().map(|f| KvItem { key: f.key.clone(), value: if f.is_file() { f.files().join(", ") } else { f.value.clone().unwrap_or_default() }, description: cartero_model::description_text(&f.description), enabled: !f.disabled, flag: f.is_file() }).collect();
        self.formdata.update(cx, |p, cx| p.set_items(form, window, cx));
        self.file_path = body.file_src();
        let auth = req.auth.clone().flatten().filter(|a| !a.is_inherit());
        self.auth.update(cx, |a, cx| a.load(auth, window, cx));
        let pre = script_of(&item.event, "prerequest").unwrap_or_default();
        let post = script_of(&item.event, "test").unwrap_or_default();
        self.pre.update(cx, |s, cx| s.set_value(pre, window, cx));
        self.post.update(cx, |s, cx| s.set_value(post, window, cx));
        let docs = cartero_model::description_text(&req.description);
        self.docs.update(cx, |s, cx| s.set_value(docs, window, cx));
        self.name = item.name.clone();
        self.base = item;
        self.syncing = false;
        cx.emit(TabEvent::Changed);
        cx.notify();
    }

    /// Recarga desde la base de datos (si se cambió desde otro sitio y aquí no hay cambios).
    pub fn reload(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(id) = self.item_id.clone() else { return };
        if let Ok(item) = self.app.read(cx).store.item(&id) {
            self.load_item(item, window, cx);
            self.dirty = false;
        }
    }

    /// El ítem tal y como está en los editores.
    pub fn build_item(&self, cx: &App) -> Item {
        let mut item = self.base.clone();
        item.name = self.name.clone();
        let mut req: Request = item.request.clone().unwrap_or_default();
        req.method = self.method.clone();
        let raw = self.url.read(cx).value().to_string();
        let mut parts = cartero_model::url::parse(&raw);
        let params = self.params.read(cx).items(cx);
        parts.query = (!params.is_empty()).then(|| {
            params
                .into_iter()
                .map(|p| QueryParam {
                    key: Some(p.key),
                    value: Some(p.value),
                    description: (!p.description.is_empty()).then(|| Value::String(p.description)),
                    disabled: !p.enabled,
                    ..Default::default()
                })
                .collect()
        });
        let pv = self.path_vars.read(cx).items(cx);
        parts.variable = (!pv.is_empty()).then(|| pv.into_iter().map(|v| Variable::new(v.key, v.value)).collect());
        req.url = Url::Parts(parts);
        let headers = self.headers.read(cx).items(cx);
        req.header = Some(kv_to_headers(headers, req.headers()));
        let base_body = req.body.clone().unwrap_or_default();
        req.body = match self.body_mode.as_str() {
            "none" => None,
            mode => {
                let mut b = Body { mode: Some(mode.to_string()), options: base_body.options.clone(), extra: base_body.extra.clone(), ..Default::default() };
                match mode {
                    "raw" => {
                        b.raw = Some(self.raw.read(cx).value().to_string());
                        b.set_raw_language(&self.raw_lang);
                    }
                    "urlencoded" => b.urlencoded = Some(kv_to_headers(self.urlencoded.read(cx).items(cx), base_body.urlencoded.as_deref().unwrap_or_default())),
                    "formdata" => {
                        b.formdata = Some(
                            self.formdata
                                .read(cx)
                                .items(cx)
                                .into_iter()
                                .map(|i| FormParam {
                                    key: i.key,
                                    value: (!i.flag).then_some(i.value.clone()),
                                    src: i.flag.then(|| Value::String(i.value.clone())),
                                    kind: Some(if i.flag { "file" } else { "text" }.into()),
                                    description: (!i.description.is_empty()).then(|| Value::String(i.description)),
                                    disabled: !i.enabled,
                                    ..Default::default()
                                })
                                .collect(),
                        )
                    }
                    "file" => b.file = Some(serde_json::json!({ "src": self.file_path.clone().unwrap_or_default() })),
                    "graphql" => b.graphql = Some(serde_json::json!({ "query": self.gql_query.read(cx).value().to_string(), "variables": self.gql_vars.read(cx).value().to_string() })),
                    _ => {}
                }
                Some(b)
            }
        };
        req.auth = self.auth.read(cx).value(cx).map(Some);
        let docs = self.docs.read(cx).value().to_string();
        req.description = (!docs.trim().is_empty()).then(|| Value::String(docs));
        item.request = Some(req);
        set_script(&mut item.event, "prerequest", self.pre.read(cx).value().as_ref());
        set_script(&mut item.event, "test", self.post.read(cx).value().as_ref());
        item
    }

    pub fn title(&self) -> SharedString {
        if self.name.trim().is_empty() { tr("Petición nueva") } else { self.name.clone().into() }
    }

    // ───────────────────────────── Enviar ─────────────────────────────

    pub fn is_sending(&self) -> bool {
        self.sending.is_some()
    }

    pub fn send(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.sending.is_some() {
            return;
        }
        let item = self.build_item(cx);
        if item.request.as_ref().is_none_or(|r| r.url.raw().trim().is_empty()) {
            window.push_notification(Notification::warning(tr("Escribe una URL antes de enviar")), cx);
            return;
        }
        let app = self.app.read(cx);
        let ctx = app.run_context(self.collection_id.as_deref(), &item);
        let before = ctx.vars.clone();
        let workspace = app.workspace.id.clone();
        let task = crate::runtime::spawn(async move {
            let mut ctx = ctx;
            let outcome = cartero_runner::execute(&mut ctx, &item, &ExecOptions::default()).await;
            (outcome, ctx.vars, item)
        });
        self.sending = Some(task.abort_handle());
        self.response.update(cx, |r, cx| r.set_sending(true, cx));
        cx.emit(TabEvent::Changed);
        cx.notify();
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            let _ = this.update_in(cx, |this, window, cx| {
                this.sending = None;
                match result {
                    Ok((outcome, after, item)) => this.on_outcome(outcome, &before, &after, item, &workspace, window, cx),
                    Err(_) => this.response.update(cx, |r, cx| r.set_sending(false, cx)),
                }
                cx.emit(TabEvent::Changed);
                cx.notify();
            });
        })
        .detach();
    }

    pub fn cancel(&mut self, cx: &mut Context<Self>) {
        if let Some(h) = self.sending.take() {
            h.abort();
            self.response.update(cx, |r, cx| r.set_sending(false, cx));
            cx.emit(TabEvent::Changed);
            cx.notify();
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn on_outcome(&mut self, outcome: Outcome, before: &cartero_runner::VarState, after: &cartero_runner::VarState, item: Item, workspace: &str, window: &mut Window, cx: &mut Context<Self>) {
        let entry = cartero_store::HistoryEntry {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id: workspace.to_string(),
            item_id: self.item_id.clone(),
            method: outcome.prepared.method.clone(),
            url: outcome.prepared.url.clone(),
            status: outcome.response.as_ref().map(|r| r.status),
            time_ms: outcome.response.as_ref().map(|r| r.timings.total.as_millis() as u64),
            request: serde_json::to_value(&item).unwrap_or_default(),
            created_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        };
        let cid = self.collection_id.clone();
        self.app.update(cx, |app, cx| {
            let _ = app.store.add_history(&entry);
            app.persist_script_vars(before, after, cid.as_deref(), cx);
            app.save_cookies();
            app.reload_history(cx);
        });
        self.response.update(cx, |r, cx| r.set_outcome(Some(outcome), window, cx));
    }

    // ───────────────────────────── Guardar ─────────────────────────────

    pub fn save(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let item = self.build_item(cx);
        match &self.item_id {
            Some(_) => {
                let result = self.app.read(cx).store.save_item(&item);
                match result {
                    Ok(()) => self.after_save(item, window, cx),
                    Err(e) => window.push_notification(Notification::error(e.to_string()).title(tr("No se pudo guardar")), cx),
                }
            }
            None => crate::ui::dialogs::save_request_as(cx.entity(), window, cx),
        }
    }

    /// Guarda una petición nueva dentro de una colección (o carpeta).
    pub fn save_into(&mut self, collection: &str, parent: Option<&str>, name: String, window: &mut Window, cx: &mut Context<Self>) {
        self.name = name;
        let mut item = self.build_item(cx);
        item.id = Some(cartero_model::new_id());
        let result = self.app.read(cx).store.create_item(collection, parent, usize::MAX, &item);
        match result {
            Ok(id) => {
                item.id = Some(id.clone());
                self.item_id = Some(id);
                self.collection_id = Some(collection.to_string());
                self.after_save(item, window, cx);
            }
            Err(e) => window.push_notification(Notification::error(e.to_string()).title(tr("No se pudo guardar")), cx),
        }
    }

    fn after_save(&mut self, item: Item, window: &mut Window, cx: &mut Context<Self>) {
        self.base = item;
        self.dirty = false;
        let id = self.item_id.clone().unwrap_or_default();
        self.app.update(cx, |app, cx| {
            app.reload_collections(cx);
            cx.emit(StateEvent::ItemChanged(id));
        });
        window.push_notification(Notification::success(tr("Guardado")), cx);
        cx.emit(TabEvent::Changed);
        cx.notify();
    }

    pub fn rename(&mut self, name: String, cx: &mut Context<Self>) {
        self.name = name;
        self.mark_dirty(cx);
    }

    fn set_method(&mut self, m: String, cx: &mut Context<Self>) {
        self.method = m;
        self.mark_dirty(cx);
        cx.emit(TabEvent::Changed);
    }

    fn set_body_mode(&mut self, mode: String, cx: &mut Context<Self>) {
        self.body_mode = mode;
        self.mark_dirty(cx);
    }

    fn set_raw_lang(&mut self, lang: String, window: &mut Window, cx: &mut Context<Self>) {
        self.raw_lang = lang;
        let l = raw_language_for_editor(&self.raw_lang);
        self.raw.update(cx, |s, cx| s.set_highlighter(l, cx));
        // Content-Type automático, como Postman: lo pone el motor si no hay cabecera
        let _ = window;
        self.mark_dirty(cx);
    }

    fn beautify(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let text = self.raw.read(cx).value().to_string();
        if let Some(p) = crate::ui::response::pretty_json(&text) {
            self.raw.update(cx, |s, cx| s.set_value(p, window, cx));
            self.mark_dirty(cx);
        } else {
            window.push_notification(Notification::warning(tr("El cuerpo no es JSON válido")), cx);
        }
    }

    fn pick_body_file(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let rx = cx.prompt_for_paths(PathPromptOptions { files: true, directories: false, multiple: false, prompt: Some(tr("Elegir fichero")) });
        cx.spawn_in(window, async move |this, cx| {
            if let Ok(Ok(Some(paths))) = rx.await
                && let Some(p) = paths.first()
            {
                let path = p.to_string_lossy().to_string();
                let _ = this.update(cx, |this, cx| {
                    this.file_path = Some(path);
                    this.mark_dirty(cx);
                });
            }
        })
        .detach();
    }

    fn insert_snippet(&mut self, code: &str, window: &mut Window, cx: &mut Context<Self>) {
        let target = if self.script_kind == ScriptKind::Pre { self.pre.clone() } else { self.post.clone() };
        let current = target.read(cx).value().to_string();
        let next = if current.trim().is_empty() { code.to_string() } else { format!("{}\n\n{code}", current.trim_end()) };
        target.update(cx, |s, cx| s.set_value(next, window, cx));
        self.mark_dirty(cx);
    }

    // ───────────────────────────── Vista ─────────────────────────────

    fn render_url_bar(&self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let entity = cx.entity();
        let method = self.method.clone();
        let method_color = crate::theme::method_color(&method, cx);
        let method_btn = Button::new("method").outline().label(method.clone()).dropdown_caret(true).text_color(method_color).font_semibold().w(px(118.)).dropdown_menu({
            let entity = entity.clone();
            move |mut menu, _, cx| {
                for m in METHODS {
                    let entity = entity.clone();
                    menu = menu.item(
                        PopupMenuItem::element(move |_, cx| div().text_color(crate::theme::method_color(m, cx)).font_semibold().child(m))
                            .on_click(move |_, _, cx| entity.update(cx, |this, cx| this.set_method(m.to_string(), cx))),
                    );
                }
                let _ = cx;
                menu
            }
        });
        let send_btn = if self.sending.is_some() {
            Button::new("cancel").outline().icon(IconName::X).label(tr("Cancelar")).on_click(cx.listener(|this, _, _, cx| this.cancel(cx)))
        } else {
            Button::new("send").primary().icon(IconName::Send).label(tr("Enviar")).tooltip(tr("Enviar (Ctrl+Intro)")).on_click(cx.listener(|this, _, window, cx| this.send(window, cx)))
        };
        div()
            .h_flex()
            .gap_2()
            .child(method_btn)
            .child(div().flex_1().min_w_0().child(Input::new(&self.url).font_family(cx.theme().mono_font_family.clone())))
            .child(send_btn)
            .child(
                Button::new("save")
                    .outline()
                    .icon(IconName::Save)
                    .tooltip(tr("Guardar (Ctrl+S)"))
                    .on_click(cx.listener(|this, _, window, cx| this.save(window, cx))),
            )
            .child(
                Button::new("code")
                    .ghost()
                    .icon(IconName::Code)
                    .tooltip(tr("Ver como código (cURL, Python, Go…)"))
                    .on_click(cx.listener(|this, _, window, cx| crate::ui::dialogs::codegen(this.app.clone(), this.collection_id.clone(), this.build_item(cx), window, cx))),
            )
    }

    /// Las {{variables}} de la URL con su valor (verde) o sin definir (rojo).
    fn render_variables(&self, cx: &Context<Self>) -> Option<impl IntoElement + use<>> {
        let raw = self.url.read(cx).value().to_string();
        let names = cartero_model::vars::names(&raw);
        if names.is_empty() {
            return None;
        }
        let app = self.app.read(cx);
        let collection = self.collection_id.as_ref().and_then(|id| app.trees.get(id));
        let layers = app.var_state(collection).layers();
        let scopes = [tr("global"), tr("colección"), tr("entorno")];
        let ok = crate::theme::status_color(200, cx);
        let bad = cx.theme().danger;
        let muted = cx.theme().muted_foreground;
        let chips = names.into_iter().map(|n| {
            let (text, color): (SharedString, Hsla) = if n.starts_with('$') && cartero_model::vars::dynamic(&n).is_some() {
                (format!("{{{{{n}}}}} → {}", tr("dinámica")).into(), muted)
            } else {
                match layers.get(&n) {
                    Some(v) => {
                        let scope = layers.source(&n).and_then(|i| scopes.get(i).cloned()).unwrap_or_default();
                        let shown: String = v.chars().take(60).collect();
                        (format!("{{{{{n}}}}} = {shown}  · {scope}").into(), ok)
                    }
                    None => (format!("{{{{{n}}}}} · {}", tr("sin definir")).into(), bad),
                }
            };
            div().px_2().py_0p5().rounded(px(4.)).border_1().border_color(color.opacity(0.35)).bg(color.opacity(0.08)).text_xs().text_color(color).child(text)
        });
        Some(div().h_flex().flex_wrap().gap_1().children(chips))
    }

    fn render_section(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let muted = cx.theme().muted_foreground;
        match self.section {
            Section::Params => {
                let has_path = !self.path_vars.read(cx).items(cx).is_empty() || cartero_model::url::parse(self.url.read(cx).value().as_ref()).variable.is_some();
                div()
                    .v_flex()
                    .gap_3()
                    .p_3()
                    .child(div().text_sm().text_color(muted).child(tr("Parámetros de la URL (query). Se sincronizan con la barra de la URL.")))
                    .child(self.params.clone())
                    .when(has_path, |d| d.child(div().text_sm().font_semibold().pt_2().child(tr("Variables de ruta"))).child(self.path_vars.clone()))
                    .into_any_element()
            }
            Section::Auth => self.auth.clone().into_any_element(),
            Section::Headers => div()
                .v_flex()
                .gap_3()
                .p_3()
                .child(div().text_sm().text_color(muted).child(tr("Cartero añade User-Agent, Accept y Host si no los pones tú; Content-Type sale del tipo de cuerpo.")))
                .child(self.headers.clone())
                .into_any_element(),
            Section::Body => self.render_body(cx),
            Section::Scripts => self.render_scripts(cx),
            Section::Docs => div()
                .v_flex()
                .size_full()
                .p_3()
                .gap_2()
                .child(div().text_sm().text_color(muted).child(tr("Explica qué hace esta petición (admite Markdown). Se publica con la documentación de la colección.")))
                .child(div().flex_1().min_h(px(160.)).child(Editor::new(&self.docs).h_full()))
                .into_any_element(),
        }
    }

    fn render_body(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let entity = cx.entity();
        let modes: Vec<(SharedString, String)> = vec![
            (tr("Ninguno"), "none".into()),
            ("raw".into(), "raw".into()),
            ("x-www-form-urlencoded".into(), "urlencoded".into()),
            ("form-data".into(), "formdata".into()),
            (tr("Binario"), "file".into()),
            ("GraphQL".into(), "graphql".into()),
        ];
        let mode_picker = choice("body-mode", &self.body_mode, modes, {
            let entity = entity.clone();
            move |m, _, cx| entity.update(cx, |this, cx| this.set_body_mode(m, cx))
        });
        let mut bar = div().h_flex().gap_2().px_3().py_2().child(mode_picker);
        if self.body_mode == "raw" {
            let langs: Vec<(SharedString, String)> =
                vec![("JSON".into(), "json".into()), ("Text".into(), "text".into()), ("XML".into(), "xml".into()), ("HTML".into(), "html".into()), ("JavaScript".into(), "javascript".into())];
            bar = bar.child(choice("raw-lang", &self.raw_lang, langs, {
                let entity = entity.clone();
                move |l, window, cx| entity.update(cx, |this, cx| this.set_raw_lang(l, window, cx))
            }));
            if self.raw_lang == "json" {
                bar = bar.child(Button::new("beautify").ghost().small().label(tr("Dar formato")).on_click(cx.listener(|this, _, window, cx| this.beautify(window, cx))));
            }
        }
        let muted = cx.theme().muted_foreground;
        let content: AnyElement = match self.body_mode.as_str() {
            "raw" => div().flex_1().min_h(px(120.)).child(Editor::new(&self.raw).h_full()).into_any_element(),
            "urlencoded" => div().px_3().child(self.urlencoded.clone()).into_any_element(),
            "formdata" => div().px_3().v_flex().gap_2().child(div().text_xs().text_color(muted).child(tr("Pulsa el icono de subir en una fila para enviar un fichero."))).child(self.formdata.clone()).into_any_element(),
            "file" => div()
                .px_3()
                .h_flex()
                .gap_2()
                .child(Button::new("pick-file").outline().small().icon(IconName::Upload).label(tr("Elegir fichero")).on_click(cx.listener(|this, _, w, cx| this.pick_body_file(w, cx))))
                .child(div().text_sm().text_color(muted).child(self.file_path.clone().unwrap_or_else(|| tr("Ningún fichero elegido").to_string())))
                .into_any_element(),
            "graphql" => div()
                .flex_1()
                .min_h(px(160.))
                .child(
                    h_resizable("gql-split")
                        .child(resizable_panel().child(div().size_full().v_flex().child(div().px_3().text_xs().text_color(muted).child(tr("Consulta"))).child(div().flex_1().child(Editor::new(&self.gql_query).h_full()))))
                        .child(resizable_panel().child(div().size_full().v_flex().child(div().px_3().text_xs().text_color(muted).child(tr("Variables (JSON)"))).child(div().flex_1().child(Editor::new(&self.gql_vars).h_full())))),
                )
                .into_any_element(),
            _ => div().p_3().text_sm().text_color(muted).child(tr("Esta petición no envía cuerpo.")).into_any_element(),
        };
        div().v_flex().size_full().child(bar).child(content).into_any_element()
    }

    fn render_scripts(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let muted = cx.theme().muted_foreground;
        let kind = self.script_kind;
        let tabs = TabBar::new("script-kind")
            .segmented()
            .selected_index(if kind == ScriptKind::Pre { 0 } else { 1 })
            .child(Tab::new().label(tr("Antes de enviar")))
            .child(Tab::new().label(tr("Después de la respuesta")))
            .on_click(cx.listener(|this, ix: &usize, _, cx| {
                this.script_kind = if *ix == 0 { ScriptKind::Pre } else { ScriptKind::Post };
                cx.notify();
            }));
        let editor_el = if kind == ScriptKind::Pre { Editor::new(&self.pre).h_full() } else { Editor::new(&self.post).h_full() };
        let snippets: Vec<(SharedString, &'static str)> = if kind == ScriptKind::Pre {
            vec![
                (tr("Guardar una variable de entorno"), "pm.environment.set(\"variable\", \"valor\")"),
                (tr("Leer una variable"), "const valor = pm.variables.get(\"variable\")"),
                (tr("Marca de tiempo"), "pm.variables.set(\"timestamp\", Date.now())"),
                (tr("Añadir una cabecera"), "pm.request.headers.add({ key: \"X-Request-Id\", value: pm.variables.replaceIn(\"{{$guid}}\") })"),
                (tr("Pedir un token antes"), "pm.sendRequest({\n  url: pm.environment.get(\"baseUrl\") + \"/login\",\n  method: \"POST\",\n  header: { \"Content-Type\": \"application/json\" },\n  body: { mode: \"raw\", raw: JSON.stringify({ user: \"demo\", password: \"demo\" }) }\n}, (err, res) => {\n  pm.environment.set(\"token\", res.json().token)\n})"),
            ]
        } else {
            vec![
                (tr("Código de estado 200"), "pm.test(\"Responde 200\", () => {\n  pm.response.to.have.status(200)\n})"),
                (tr("Tiempo de respuesta"), "pm.test(\"Responde en menos de 500 ms\", () => {\n  pm.expect(pm.response.responseTime).to.be.below(500)\n})"),
                (tr("Valor en el JSON"), "pm.test(\"El JSON trae el valor esperado\", () => {\n  const json = pm.response.json()\n  pm.expect(json.id).to.eql(1)\n})"),
                (tr("El cuerpo contiene un texto"), "pm.test(\"El cuerpo contiene un texto\", () => {\n  pm.expect(pm.response.text()).to.include(\"texto\")\n})"),
                (tr("Cabecera Content-Type"), "pm.test(\"Responde JSON\", () => {\n  pm.response.to.have.header(\"Content-Type\")\n  pm.expect(pm.response.headers.get(\"Content-Type\")).to.include(\"application/json\")\n})"),
                (tr("Validar con un esquema JSON"), "const schema = {\n  type: \"object\",\n  required: [\"id\"],\n  properties: { id: { type: \"number\" } }\n}\npm.test(\"Cumple el esquema\", () => {\n  pm.response.to.have.jsonSchema(schema)\n})"),
                (tr("Guardar un valor de la respuesta"), "const json = pm.response.json()\npm.environment.set(\"token\", json.token)"),
                (tr("Ir a otra petición (runner)"), "pm.execution.setNextRequest(\"Nombre de la petición\")"),
            ]
        };
        let snippet_list = div().v_flex().w(px(230.)).flex_none().gap_0p5().p_2().border_l_1().border_color(cx.theme().border).child(div().text_xs().font_semibold().text_color(muted).pb_1().child(tr("Fragmentos"))).children(
            snippets.into_iter().enumerate().map(|(i, (label, code))| {
                div()
                    .id(("snippet", i))
                    .px_2()
                    .py_1()
                    .rounded(px(4.))
                    .text_xs()
                    .text_color(cx.theme().link)
                    .cursor_pointer()
                    .hover(|s| s.bg(cx.theme().muted))
                    .child(label)
                    .on_click(cx.listener(move |this, _, window, cx| this.insert_snippet(code, window, cx)))
            }),
        );
        div()
            .v_flex()
            .size_full()
            .child(div().h_flex().gap_3().px_3().py_2().child(tabs).child(div().text_xs().text_color(muted).child(if kind == ScriptKind::Pre {
                tr("Se ejecuta antes de enviar. La colección y las carpetas pueden tener los suyos, que van antes.")
            } else {
                tr("Se ejecuta con la respuesta: escribe aquí los tests con pm.test y pm.expect.")
            })))
            .child(div().flex_1().min_h_0().flex().flex_row().child(div().flex_1().h_full().child(editor_el)).child(snippet_list.h_full()))
            .into_any_element()
    }
}

impl Focusable for RequestTab {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl Render for RequestTab {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let counts = (self.params.read(cx).count(cx), self.headers.read(cx).count(cx));
        let has_body = self.body_mode != "none";
        let has_scripts = !self.pre.read(cx).value().trim().is_empty() || !self.post.read(cx).value().trim().is_empty();
        let sections = [
            (Section::Params, tr("Parámetros"), counts.0, false),
            (Section::Auth, tr("Autorización"), 0, false),
            (Section::Headers, tr("Cabeceras"), counts.1, false),
            (Section::Body, tr("Cuerpo"), 0, has_body),
            (Section::Scripts, tr("Scripts"), 0, has_scripts),
            (Section::Docs, tr("Descripción"), 0, false),
        ];
        let selected = sections.iter().position(|s| s.0 == self.section).unwrap_or(0);
        let brand = crate::theme::brand();
        let tabs = TabBar::new("request-sections")
            .underline()
            .selected_index(selected)
            .children(sections.iter().map(|(_, label, n, dot)| {
                let t = Tab::new().label(if *n > 0 { SharedString::from(format!("{label} ({n})")) } else { label.clone() });
                if *dot { t.suffix(div().size_1p5().rounded_full().bg(brand)) } else { t }
            }))
            .on_click(cx.listener(move |this, ix: &usize, _, cx| {
                this.section = sections[*ix].0;
                cx.notify();
            }));
        let top = div()
            .v_flex()
            .size_full()
            .child(div().v_flex().gap_2().px_3().pt_3().pb_1().child(self.render_url_bar(cx)).children(self.render_variables(cx)))
            .child(div().px_1().child(tabs))
            .child(div().id("request-section").flex_1().min_h_0().when(!matches!(self.section, Section::Body | Section::Scripts | Section::Docs), |d| d.overflow_y_scroll()).child(self.render_section(cx)));
        div().track_focus(&self.focus).size_full().child(
            v_resizable("request-split")
                .child(resizable_panel().size(px(360.)).size_range(px(160.)..px(2000.)).child(top))
                .child(resizable_panel().child(div().size_full().border_t_1().border_color(cx.theme().border).child(self.response.clone()))),
        )
    }
}
