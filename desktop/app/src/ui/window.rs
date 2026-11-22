//! Ventana principal: barra de título, barra de actividad, barra lateral y pestañas.

use cartero_model::{Item, Request};
use gpui_kit::component::TitleBar;
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::menu::{DropdownMenu as _, PopupMenuItem};
use gpui_kit::component::notification::Notification;
use gpui_kit::component::{h_resizable, resizable_panel};

use crate::state::{AppState, StateEvent};
use crate::ui::collection::CollectionTab;
use crate::ui::dialogs;
use crate::ui::environment::EnvironmentTab;
use crate::ui::prelude::*;
use crate::ui::request::{RequestTab, TabEvent};
use crate::ui::runner::RunnerTab;
use crate::ui::settings::SettingsTab;
use crate::ui::sidebar::{Panel, Sidebar, SidebarEvent};
use crate::ui::widgets::method_label;

gpui_kit::actions!(cartero, [NewRequest, CloseTab, SaveTab, SendRequest, CommandPalette, ImportData, ToggleSidebar, NextTab, PrevTab, FocusUrl, OpenSettings, SearchRequests]);

/// Ctrl en Windows y Linux, Cmd en macOS.
fn k(keys: &str) -> &'static str {
    let s = if cfg!(target_os = "macos") { format!("cmd-{keys}") } else { format!("ctrl-{keys}") };
    Box::leak(s.into_boxed_str())
}

pub fn bind_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new(k("t"), NewRequest, None),
        KeyBinding::new(k("n"), NewRequest, None),
        KeyBinding::new(k("w"), CloseTab, None),
        KeyBinding::new(k("s"), SaveTab, None),
        KeyBinding::new(k("enter"), SendRequest, None),
        KeyBinding::new(k("k"), CommandPalette, None),
        KeyBinding::new(k("p"), CommandPalette, None),
        KeyBinding::new(k("o"), ImportData, None),
        KeyBinding::new(k("b"), ToggleSidebar, None),
        KeyBinding::new("ctrl-tab", NextTab, None),
        KeyBinding::new("ctrl-shift-tab", PrevTab, None),
        KeyBinding::new(k("l"), FocusUrl, None),
        KeyBinding::new(k(","), OpenSettings, None),
        KeyBinding::new(k("shift-f"), SearchRequests, None),
    ]);
}

pub enum TabKind {
    Request(Entity<RequestTab>),
    Environment(Entity<EnvironmentTab>),
    Collection(Entity<CollectionTab>),
    Runner(Entity<RunnerTab>),
    Settings(Entity<SettingsTab>),
}

struct OpenTab {
    kind: TabKind,
    _sub: Subscription,
}

impl OpenTab {
    fn focus_handle(&self, cx: &App) -> FocusHandle {
        match &self.kind {
            TabKind::Request(t) => t.read(cx).focus_handle().clone(),
            TabKind::Environment(t) => t.focus_handle(cx),
            TabKind::Collection(t) => t.focus_handle(cx),
            TabKind::Runner(t) => t.focus_handle(cx),
            TabKind::Settings(t) => t.focus_handle(cx),
        }
    }
    fn dirty(&self, cx: &App) -> bool {
        match &self.kind {
            TabKind::Request(t) => t.read(cx).dirty,
            TabKind::Environment(t) => t.read(cx).dirty,
            TabKind::Collection(t) => t.read(cx).dirty,
            _ => false,
        }
    }
    fn title(&self, cx: &App) -> SharedString {
        match &self.kind {
            TabKind::Request(t) => t.read(cx).title(),
            TabKind::Environment(t) => t.read(cx).title(cx),
            TabKind::Collection(t) => t.read(cx).title(),
            TabKind::Runner(t) => t.read(cx).title(),
            TabKind::Settings(_) => tr("Ajustes"),
        }
    }
}

pub struct MainWindow {
    app: Entity<AppState>,
    sidebar: Entity<Sidebar>,
    tabs: Vec<OpenTab>,
    active: usize,
    show_sidebar: bool,
    focus: FocusHandle,
    _subs: Vec<Subscription>,
}

impl MainWindow {
    pub fn new(app: Entity<AppState>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let sidebar = cx.new(|cx| Sidebar::new(app.clone(), window, cx));
        let mut subs = vec![];
        subs.push(cx.subscribe_in(&sidebar, window, |this, _, ev: &SidebarEvent, window, cx| this.on_sidebar(ev, window, cx)));
        subs.push(cx.subscribe_in(&app, window, |this, _, ev: &StateEvent, window, cx| this.on_state(ev, window, cx)));
        subs.push(cx.observe_window_appearance(window, |this, window, cx| {
            let choice = this.app.read(cx).settings.theme;
            if choice == crate::settings::ThemeChoice::System {
                crate::theme::apply(choice, Some(window), cx);
            }
        }));
        let mut this = Self { app, sidebar, tabs: vec![], active: 0, show_sidebar: true, focus: cx.focus_handle(), _subs: subs };
        this.restore_session(window, cx);
        if this.app.read(cx).settings.check_updates {
            let app = this.app.clone();
            window.defer(cx, move |window, cx| crate::update::check_now(app, false, window, cx));
        }
        this
    }

    // ───────────────────────────── Pestañas ─────────────────────────────

    fn push_tab(&mut self, kind: TabKind, window: &mut Window, cx: &mut Context<Self>) {
        let sub = match &kind {
            TabKind::Request(t) => cx.subscribe_in(t, window, |this, _, _: &TabEvent, _, cx| {
                this.save_session(cx);
                cx.notify()
            }),
            TabKind::Environment(t) => cx.subscribe_in(t, window, |_, _, _: &TabEvent, _, cx| cx.notify()),
            TabKind::Collection(t) => cx.subscribe_in(t, window, |_, _, _: &TabEvent, _, cx| cx.notify()),
            TabKind::Runner(t) => cx.subscribe_in(t, window, |_, _, _: &TabEvent, _, cx| cx.notify()),
            TabKind::Settings(t) => cx.subscribe_in(t, window, |_, _, _: &TabEvent, _, cx| cx.notify()),
        };
        self.tabs.push(OpenTab { kind, _sub: sub });
        self.activate(self.tabs.len() - 1, window, cx);
        self.save_session(cx);
    }

    fn activate(&mut self, ix: usize, window: &mut Window, cx: &mut Context<Self>) {
        if ix < self.tabs.len() {
            self.active = ix;
            let fh = self.tabs[ix].focus_handle(cx);
            window.focus(&fh, cx);
            cx.notify();
        }
    }

    fn find_tab(&self, f: impl Fn(&TabKind, &App) -> bool, cx: &App) -> Option<usize> {
        self.tabs.iter().position(|t| f(&t.kind, cx))
    }

    pub fn open_item(&mut self, collection: String, item_id: String, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(ix) = self.find_tab(|k, cx| matches!(k, TabKind::Request(t) if t.read(cx).item_id.as_deref() == Some(item_id.as_str())), cx) {
            self.activate(ix, window, cx);
            return;
        }
        let item = self.app.read(cx).trees.get(&collection).and_then(|c| cartero_model::tree::find(&c.item, &item_id).cloned());
        let Some(item) = item else { return };
        let app = self.app.clone();
        let tab = cx.new(|cx| RequestTab::new(app, Some(collection), item, true, window, cx));
        self.push_tab(TabKind::Request(tab), window, cx);
    }

    pub fn new_request(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let app = self.app.clone();
        let item = Item::request("", Request::new("GET", ""));
        let tab = cx.new(|cx| RequestTab::new(app, None, item, false, window, cx));
        self.push_tab(TabKind::Request(tab.clone()), window, cx);
        tab.update(cx, |t, cx| t.focus_url(window, cx));
    }

    fn open_history(&mut self, entry: &cartero_store::HistoryEntry, window: &mut Window, cx: &mut Context<Self>) {
        // Si la petición sigue guardada, se abre la guardada
        if let Some(id) = &entry.item_id
            && let Some(cid) = self.app.read(cx).collection_of_item(id).and_then(|c| c.info.postman_id.clone())
        {
            self.open_item(cid, id.clone(), window, cx);
            return;
        }
        let mut item: Item = serde_json::from_value(entry.request.clone()).unwrap_or_else(|_| Item::request("", Request::new(&entry.method, &entry.url)));
        item.id = Some(cartero_model::new_id());
        let app = self.app.clone();
        let tab = cx.new(|cx| RequestTab::new(app, None, item, false, window, cx));
        self.push_tab(TabKind::Request(tab), window, cx);
    }

    fn open_environment(&mut self, id: Option<String>, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(ix) = self.find_tab(|k, cx| matches!(k, TabKind::Environment(t) if t.read(cx).env_id == id), cx) {
            self.activate(ix, window, cx);
            return;
        }
        let app = self.app.clone();
        let tab = cx.new(|cx| EnvironmentTab::new(app, id, window, cx));
        self.push_tab(TabKind::Environment(tab), window, cx);
    }

    fn open_collection_settings(&mut self, collection: String, folder: Option<String>, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(ix) = self.find_tab(|k, cx| matches!(k, TabKind::Collection(t) if t.read(cx).collection_id == collection && t.read(cx).folder_id == folder), cx) {
            self.activate(ix, window, cx);
            return;
        }
        let app = self.app.clone();
        let tab = cx.new(|cx| CollectionTab::new(app, collection, folder, window, cx));
        self.push_tab(TabKind::Collection(tab), window, cx);
    }

    fn open_runner(&mut self, collection: String, folder: Option<String>, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(ix) = self.find_tab(|k, cx| matches!(k, TabKind::Runner(t) if t.read(cx).collection_id == collection && t.read(cx).folder_id == folder), cx) {
            self.activate(ix, window, cx);
            return;
        }
        let app = self.app.clone();
        let tab = cx.new(|cx| RunnerTab::new(app, collection, folder, window, cx));
        self.push_tab(TabKind::Runner(tab), window, cx);
    }

    pub fn open_settings(&mut self, section: Option<crate::ui::settings::Section>, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(ix) = self.find_tab(|k, _| matches!(k, TabKind::Settings(_)), cx) {
            if let (Some(s), TabKind::Settings(t)) = (section, &self.tabs[ix].kind) {
                t.update(cx, |t, cx| {
                    t.section = s;
                    cx.notify()
                });
            }
            self.activate(ix, window, cx);
            return;
        }
        let app = self.app.clone();
        let tab = cx.new(|cx| SettingsTab::new(app, window, cx));
        if let Some(s) = section {
            tab.update(cx, |t, _| t.section = s);
        }
        self.push_tab(TabKind::Settings(tab), window, cx);
    }

    fn close_tab(&mut self, ix: usize, window: &mut Window, cx: &mut Context<Self>) {
        let Some(tab) = self.tabs.get(ix) else { return };
        if tab.dirty(cx) {
            let this = cx.entity();
            let title = tab.title(cx);
            dialogs::confirm(
                tr("Cambios sin guardar"),
                trf("«{name}» tiene cambios sin guardar. Si cierras la pestaña, se perderán.", &[("name", &title)]),
                tr("Cerrar sin guardar"),
                window,
                cx,
                move |window, cx| this.update(cx, |this, cx| this.force_close(ix, window, cx)),
            );
            return;
        }
        self.force_close(ix, window, cx);
    }

    fn force_close(&mut self, ix: usize, window: &mut Window, cx: &mut Context<Self>) {
        if ix >= self.tabs.len() {
            return;
        }
        if let TabKind::Request(t) = &self.tabs[ix].kind {
            t.update(cx, |t, cx| t.cancel(cx));
        }
        self.tabs.remove(ix);
        if self.active >= self.tabs.len() {
            self.active = self.tabs.len().saturating_sub(1);
        } else if self.active > ix {
            self.active -= 1;
        }
        if self.tabs.is_empty() {
            window.focus(&self.focus, cx);
        } else {
            self.activate(self.active, window, cx);
        }
        self.save_session(cx);
        cx.notify();
    }

    fn close_others(&mut self, keep: usize, window: &mut Window, cx: &mut Context<Self>) {
        let mut i = self.tabs.len();
        while i > 0 {
            i -= 1;
            if i != keep && !self.tabs[i].dirty(cx) {
                self.tabs.remove(i);
            }
        }
        self.active = self.tabs.len().saturating_sub(1).min(self.active);
        self.activate(self.active, window, cx);
        self.save_session(cx);
    }

    // ───────────────────────────── Sesión ─────────────────────────────

    /// Pestañas de peticiones abiertas, para recuperarlas al volver a abrir la app.
    fn save_session(&self, cx: &App) {
        let app = self.app.read(cx);
        let ids: Vec<(String, String)> = self
            .tabs
            .iter()
            .filter_map(|t| match &t.kind {
                TabKind::Request(r) => {
                    let r = r.read(cx);
                    Some((r.collection_id.clone()?, r.item_id.clone()?))
                }
                _ => None,
            })
            .collect();
        let _ = app.store.set_setting(&format!("session:{}", app.workspace.id), &ids);
    }

    fn restore_session(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let ws = self.app.read(cx).workspace.id.clone();
        let ids: Vec<(String, String)> = self.app.read(cx).store.setting(&format!("session:{ws}")).unwrap_or_default();
        for (c, i) in ids {
            self.open_item(c, i, window, cx);
        }
        if self.tabs.is_empty()
            && let Some((cid, id)) = {
                let app = self.app.read(cx);
                app.collections.first().and_then(|m| app.trees.get(&m.id).and_then(|t| {
                    let mut flat = vec![];
                    cartero_model::tree::walk(&t.item, &mut flat, 0);
                    flat.into_iter().find(|(i, _)| !i.is_folder()).map(|(i, _)| (m.id.clone(), i.id().to_string()))
                }))
            }
            && self.app.read(cx).store.setting::<bool>("welcomed").is_none()
        {
            let _ = self.app.read(cx).store.set_setting("welcomed", &true);
            self.open_item(cid, id, window, cx);
        }
    }

    // ───────────────────────────── Eventos ─────────────────────────────

    fn on_sidebar(&mut self, ev: &SidebarEvent, window: &mut Window, cx: &mut Context<Self>) {
        match ev {
            SidebarEvent::OpenItem { collection, item } => self.open_item(collection.clone(), item.clone(), window, cx),
            SidebarEvent::OpenHistory(e) => self.open_history(e, window, cx),
            SidebarEvent::OpenEnvironment(id) => self.open_environment(Some(id.clone()), window, cx),
            SidebarEvent::OpenGlobals => self.open_environment(None, window, cx),
            SidebarEvent::OpenCollectionSettings { collection, folder } => self.open_collection_settings(collection.clone(), folder.clone(), window, cx),
            SidebarEvent::RunCollection { collection, folder } => self.open_runner(collection.clone(), folder.clone(), window, cx),
            SidebarEvent::NewRequest { .. } => self.new_request(window, cx),
        }
    }

    fn on_state(&mut self, ev: &StateEvent, window: &mut Window, cx: &mut Context<Self>) {
        match ev {
            StateEvent::Workspace => {
                self.tabs.clear();
                self.active = 0;
                self.restore_session(window, cx);
            }
            StateEvent::ItemDeleted(id) => {
                if let Some(ix) = self.find_tab(|k, cx| matches!(k, TabKind::Request(t) if t.read(cx).item_id.as_deref() == Some(id.as_str())), cx) {
                    self.force_close(ix, window, cx);
                }
            }
            StateEvent::Environments => {
                for t in &self.tabs {
                    if let TabKind::Environment(e) = &t.kind {
                        e.update(cx, |e, cx| e.on_state(ev, window, cx));
                    }
                }
            }
            _ => {}
        }
        cx.notify();
    }

    fn save_active(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        match self.tabs.get(self.active).map(|t| &t.kind) {
            Some(TabKind::Request(t)) => t.update(cx, |t, cx| t.save(window, cx)),
            Some(TabKind::Environment(t)) => t.update(cx, |t, cx| t.save(window, cx)),
            Some(TabKind::Collection(t)) => t.update(cx, |t, cx| t.save(window, cx)),
            _ => {}
        }
    }

    fn send_active(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(TabKind::Request(t)) = self.tabs.get(self.active).map(|t| &t.kind) {
            t.update(cx, |t, cx| t.send(window, cx));
        }
    }

    // ───────────────────────────── Workspaces ─────────────────────────────

    fn new_workspace(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let app = self.app.clone();
        dialogs::prompt_text(tr("Nuevo workspace"), tr("Un workspace agrupa colecciones, entornos e historial (por ejemplo, uno por proyecto)."), String::new(), tr("Crear"), window, cx, move |name, _, cx| {
            if let Ok(w) = app.read(cx).store.create_workspace(&name) {
                app.update(cx, |a, cx| {
                    a.refresh_workspaces(cx);
                    a.switch_workspace(&w.id, cx);
                });
            }
        });
    }

    fn rename_workspace(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let app = self.app.clone();
        let current = app.read(cx).workspace.name.clone();
        dialogs::prompt_text(tr("Renombrar el workspace"), tr("Nombre nuevo"), current, tr("Renombrar"), window, cx, move |name, _, cx| {
            let id = app.read(cx).workspace.id.clone();
            let _ = app.read(cx).store.rename_workspace(&id, &name);
            app.update(cx, |a, cx| a.refresh_workspaces(cx));
        });
    }

    fn delete_workspace(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let app = self.app.clone();
        if app.read(cx).workspaces.len() <= 1 {
            window.push_notification(Notification::warning(tr("Es tu único workspace: crea otro antes de borrar este.")), cx);
            return;
        }
        let name = app.read(cx).workspace.name.clone();
        dialogs::confirm(tr("Eliminar el workspace"), trf("Se borrará «{name}» con todas sus colecciones, entornos e historial de este ordenador. No se puede deshacer.", &[("name", &name)]), tr("Eliminar"), window, cx, move |_, cx| {
            let id = app.read(cx).workspace.id.clone();
            let _ = app.read(cx).store.delete_workspace(&id);
            app.update(cx, |a, cx| {
                a.refresh_workspaces(cx);
                let next = a.workspaces.first().map(|w| w.id.clone());
                if let Some(n) = next {
                    a.switch_workspace(&n, cx);
                }
            });
        });
    }

    // ───────────────────────────── Vista ─────────────────────────────

    fn render_title_bar(&mut self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let app = self.app.read(cx);
        let ws_name = app.workspace.name.clone();
        let workspaces = app.workspaces.clone();
        let current_ws = app.workspace.id.clone();
        let linked = app.workspace.server_id.is_some();
        let envs = app.environments.clone();
        let active_env = app.active_env.clone();
        let env_name: SharedString = active_env.as_ref().and_then(|id| envs.iter().find(|e| &e.id == id)).map(|e| e.name.clone().into()).unwrap_or_else(|| tr("Sin entorno"));
        let this = cx.entity();
        let app_entity = self.app.clone();
        let ws_menu = Button::new("workspace")
            .ghost()
            .small()
            .icon(if linked { IconName::Cloud } else { IconName::Box })
            .label(ws_name)
            .dropdown_caret(true)
            .dropdown_menu({
                let this = this.clone();
                let app_entity = app_entity.clone();
                move |mut menu, _, _| {
                    menu = menu.label(tr("Workspaces"));
                    for w in &workspaces {
                        let app = app_entity.clone();
                        let id = w.id.clone();
                        menu = menu.item(PopupMenuItem::new(w.name.clone()).checked(w.id == current_ws).icon(if w.server_id.is_some() { IconName::Cloud } else { IconName::Box }).on_click(move |_, _, cx| app.update(cx, |a, cx| a.switch_workspace(&id, cx))));
                    }
                    let (t1, t2, t3, t4) = (this.clone(), this.clone(), this.clone(), this.clone());
                    menu.separator()
                        .item(PopupMenuItem::new(tr("Nuevo workspace…")).icon(IconName::Plus).on_click(move |_, w, cx| t1.update(cx, |t, cx| t.new_workspace(w, cx))))
                        .item(PopupMenuItem::new(tr("Renombrar…")).icon(IconName::Pencil).on_click(move |_, w, cx| t2.update(cx, |t, cx| t.rename_workspace(w, cx))))
                        .item(PopupMenuItem::new(tr("Conectar con un servidor…")).icon(IconName::Cloud).on_click(move |_, w, cx| t4.update(cx, |t, cx| t.open_settings(Some(crate::ui::settings::Section::Servers), w, cx))))
                        .item(PopupMenuItem::new(tr("Eliminar…")).icon(IconName::Trash).on_click(move |_, w, cx| t3.update(cx, |t, cx| t.delete_workspace(w, cx))))
                }
            });
        let env_menu = Button::new("environment").outline().small().icon(IconName::Layers).label(env_name).dropdown_caret(true).dropdown_menu({
            let app_entity = app_entity.clone();
            let this = this.clone();
            move |mut menu, _, _| {
                let app = app_entity.clone();
                menu = menu.item(PopupMenuItem::new(tr("Sin entorno")).checked(active_env.is_none()).on_click(move |_, _, cx| app.update(cx, |a, cx| a.set_active_env(None, cx))));
                for e in &envs {
                    let app = app_entity.clone();
                    let id = e.id.clone();
                    menu = menu.item(PopupMenuItem::new(e.name.clone()).checked(active_env.as_deref() == Some(e.id.as_str())).on_click(move |_, _, cx| app.update(cx, |a, cx| a.set_active_env(Some(id.clone()), cx))));
                }
                let t = this.clone();
                let ae = active_env.clone();
                menu.separator().item(PopupMenuItem::new(tr("Editar entornos…")).icon(IconName::Pencil).on_click(move |_, w, cx| {
                    t.update(cx, |t, cx| {
                        t.sidebar.update(cx, |s, cx| s.set_panel(Panel::Environments, cx));
                        t.show_sidebar = true;
                        if let Some(id) = ae.clone() {
                            t.open_environment(Some(id), w, cx);
                        }
                        cx.notify();
                    })
                }))
            }
        });
        TitleBar::new().child(
            div()
                .h_flex()
                .w_full()
                .gap_2()
                .pr_2()
                .child(img("cartero/logo.svg").size_5())
                .child(div().text_sm().font_semibold().child("Cartero"))
                .child(div().w_2())
                .child(ws_menu)
                .child(div().flex_1())
                .child(crate::ui::sync_status::render(&self.app, cx))
                .child(env_menu)
                .child(Button::new("cookies").ghost().small().icon(IconName::Cookie).tooltip(tr("Cookies")).on_click(cx.listener(|this, _, w, cx| dialogs::cookies(this.app.clone(), w, cx))))
                .child(Button::new("palette").ghost().small().icon(IconName::Search).tooltip(tr("Buscar y comandos (Ctrl+K)")).on_click(cx.listener(|this, _, w, cx| crate::ui::palette::open(cx.entity(), this.app.clone(), w, cx)))),
        )
    }

    fn render_activity_bar(&mut self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let panel = self.sidebar.read(cx).panel;
        let show = self.show_sidebar;
        let btn = |id: &'static str, icon: IconName, tip: SharedString, p: Panel, cx: &mut Context<Self>| {
            Button::new(id).ghost().icon(icon).tooltip(tip).selected(show && panel == p).on_click(cx.listener(move |this, _, _, cx| {
                if this.show_sidebar && this.sidebar.read(cx).panel == p {
                    this.show_sidebar = false;
                } else {
                    this.show_sidebar = true;
                    this.sidebar.update(cx, |s, cx| s.set_panel(p, cx));
                }
                cx.notify();
            }))
        };
        div()
            .v_flex()
            .w(px(48.))
            .flex_none()
            .h_full()
            .items_center()
            .gap_1()
            .py_2()
            .bg(cx.theme().sidebar)
            .border_r_1()
            .border_color(cx.theme().border)
            .child(btn("act-collections", IconName::Folder, tr("Colecciones"), Panel::Collections, cx))
            .child(btn("act-envs", IconName::Layers, tr("Entornos"), Panel::Environments, cx))
            .child(btn("act-history", IconName::Clock, tr("Historial"), Panel::History, cx))
            .child(div().flex_1())
            .child(Button::new("act-new").ghost().icon(IconName::Plus).tooltip(tr("Petición nueva (Ctrl+T)")).on_click(cx.listener(|this, _, w, cx| this.new_request(w, cx))))
            .child(Button::new("act-settings").ghost().icon(IconName::Settings).tooltip(tr("Ajustes")).on_click(cx.listener(|this, _, w, cx| this.open_settings(None, w, cx))))
    }

    fn render_tab_bar(&mut self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let border = cx.theme().border;
        let brand = crate::theme::brand();
        let tabs = self.tabs.iter().enumerate().map(|(ix, t)| {
            let active = ix == self.active;
            let dirty = t.dirty(cx);
            let title = t.title(cx);
            let (lead, sending): (AnyElement, bool) = match &t.kind {
                TabKind::Request(r) => {
                    let r = r.read(cx);
                    (method_label(&r.method, cx).into_any_element(), r.is_sending())
                }
                TabKind::Environment(_) => (Icon::new(IconName::Layers).size_3p5().into_any_element(), false),
                TabKind::Collection(_) => (Icon::new(IconName::Settings).size_3p5().into_any_element(), false),
                TabKind::Runner(_) => (Icon::new(IconName::Play).size_3p5().into_any_element(), false),
                TabKind::Settings(_) => (Icon::new(IconName::Settings).size_3p5().into_any_element(), false),
            };
            let this = cx.entity();
            div()
                .id(("tab", ix))
                .group("tab")
                .h_flex()
                .gap_1p5()
                .h_full()
                .pl_3()
                .pr_1()
                .max_w(px(220.))
                .border_r_1()
                .border_color(border)
                .text_sm()
                .cursor_pointer()
                .when(active, |d| d.bg(cx.theme().tab_active).border_t_2().border_color(brand))
                .when(!active, |d| d.text_color(cx.theme().tab_foreground).hover(|s| s.bg(cx.theme().muted)))
                .child(lead)
                .child(div().flex_1().min_w_0().truncate().child(title))
                .child(
                    div()
                        .w_5()
                        .flex()
                        .justify_center()
                        .when(sending, |d| d.child(Icon::new(IconName::LoaderCircle).size_3()))
                        .when(!sending && dirty, |d| d.child(div().size_2().rounded_full().bg(brand)))
                        .when(!sending && !dirty, |d| {
                            d.child(Button::new(("close-tab", ix)).ghost().xsmall().icon(IconName::X).on_click(cx.listener(move |this, _, w, cx| {
                                cx.stop_propagation();
                                this.close_tab(ix, w, cx)
                            })))
                        }),
                )
                .on_click(cx.listener(move |this, _, w, cx| this.activate(ix, w, cx)))
                .on_mouse_down(MouseButton::Middle, cx.listener(move |this, _, w, cx| this.close_tab(ix, w, cx)))
                .on_mouse_down(MouseButton::Right, move |_, _, cx| {
                    let _ = this.clone();
                    let _ = cx;
                })
        });
        let this = cx.entity();
        let active = self.active;
        div()
            .id("tab-bar")
            .h(px(38.))
            .flex_none()
            .h_flex()
            .bg(cx.theme().tab_bar)
            .border_b_1()
            .border_color(border)
            .overflow_x_scroll()
            .children(tabs)
            .child(Button::new("tab-new").ghost().small().icon(IconName::Plus).tooltip(tr("Petición nueva (Ctrl+T)")).mx_1().on_click(cx.listener(|this, _, w, cx| this.new_request(w, cx))))
            .child(div().flex_1())
            .when(self.tabs.len() > 1, |d| {
                d.child(Button::new("tab-close-others").ghost().xsmall().icon(IconName::Ellipsis).tooltip(tr("Más")).mr_1().dropdown_menu(move |menu, _, _| {
                    let (t1, t2) = (this.clone(), this.clone());
                    menu.item(PopupMenuItem::new(tr("Cerrar las demás pestañas")).on_click(move |_, w, cx| t1.update(cx, |t, cx| t.close_others(active, w, cx))))
                        .item(PopupMenuItem::new(tr("Cerrar esta pestaña")).on_click(move |_, w, cx| t2.update(cx, |t, cx| t.close_tab(active, w, cx))))
                }))
            })
    }

    fn render_welcome(&mut self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let muted = cx.theme().muted_foreground;
        let tip = |keys: &'static str, text: SharedString| div().h_flex().gap_3().text_sm().child(div().w(px(110.)).text_right().font_family(cx.theme().mono_font_family.clone()).text_color(muted).child(keys)).child(text);
        div()
            .size_full()
            .v_flex()
            .items_center()
            .justify_center()
            .gap_6()
            .child(img("cartero/logo.svg").size_16())
            .child(div().v_flex().items_center().gap_1().child(div().text_2xl().font_semibold().child(tr("Tus APIs, desde tu ordenador"))).child(div().text_sm().text_color(muted).child(tr("Las peticiones salen de aquí: tu localhost, tu VPN y tu red."))))
            .child(
                div()
                    .h_flex()
                    .gap_2()
                    .child(Button::new("w-new").primary().icon(IconName::Plus).label(tr("Petición nueva")).on_click(cx.listener(|this, _, w, cx| this.new_request(w, cx))))
                    .child(Button::new("w-import").outline().icon(IconName::Import).label(tr("Importar de Postman o cURL")).on_click(cx.listener(|this, _, w, cx| dialogs::import(this.app.clone(), w, cx)))),
            )
            .child(
                div()
                    .v_flex()
                    .gap_1p5()
                    .child(tip("Ctrl+T", tr("Petición nueva")))
                    .child(tip("Ctrl+Intro", tr("Enviar")))
                    .child(tip("Ctrl+S", tr("Guardar")))
                    .child(tip("Ctrl+K", tr("Buscar peticiones y comandos")))
                    .child(tip("Ctrl+B", tr("Mostrar u ocultar la barra lateral"))),
            )
    }

    pub fn sidebar(&self) -> &Entity<Sidebar> {
        &self.sidebar
    }

    pub fn show_panel(&mut self, panel: Panel, cx: &mut Context<Self>) {
        self.show_sidebar = true;
        self.sidebar.update(cx, |s, cx| s.set_panel(panel, cx));
        cx.notify();
    }

    pub fn open_import(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        dialogs::import(self.app.clone(), window, cx);
    }

    pub fn open_runner_for(&mut self, collection: String, window: &mut Window, cx: &mut Context<Self>) {
        self.open_runner(collection, None, window, cx);
    }

    pub fn open_item_pub(&mut self, collection: String, item: String, window: &mut Window, cx: &mut Context<Self>) {
        self.open_item(collection, item, window, cx);
    }
}

impl Render for MainWindow {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let content: AnyElement = match self.tabs.get(self.active).map(|t| &t.kind) {
            Some(TabKind::Request(t)) => t.clone().into_any_element(),
            Some(TabKind::Environment(t)) => t.clone().into_any_element(),
            Some(TabKind::Collection(t)) => t.clone().into_any_element(),
            Some(TabKind::Runner(t)) => t.clone().into_any_element(),
            Some(TabKind::Settings(t)) => t.clone().into_any_element(),
            None => self.render_welcome(cx).into_any_element(),
        };
        let main = div().v_flex().size_full().when(!self.tabs.is_empty(), |d| d.child(self.render_tab_bar(cx))).child(div().flex_1().min_h_0().child(content));
        let body = if self.show_sidebar {
            h_resizable("main-split")
                .child(resizable_panel().size(px(290.)).size_range(px(200.)..px(560.)).child(self.sidebar.clone()))
                .child(resizable_panel().child(main))
                .into_any_element()
        } else {
            main.into_any_element()
        };
        let _ = window;
        div()
            .id("cartero")
            .key_context("Cartero")
            .track_focus(&self.focus)
            .on_action(cx.listener(|this, _: &NewRequest, w, cx| this.new_request(w, cx)))
            .on_action(cx.listener(|this, _: &CloseTab, w, cx| this.close_tab(this.active, w, cx)))
            .on_action(cx.listener(|this, _: &SaveTab, w, cx| this.save_active(w, cx)))
            .on_action(cx.listener(|this, _: &SendRequest, w, cx| this.send_active(w, cx)))
            .on_action(cx.listener(|this, _: &CommandPalette, w, cx| crate::ui::palette::open(cx.entity(), this.app.clone(), w, cx)))
            .on_action(cx.listener(|this, _: &ImportData, w, cx| dialogs::import(this.app.clone(), w, cx)))
            .on_action(cx.listener(|this, _: &ToggleSidebar, _, cx| {
                this.show_sidebar = !this.show_sidebar;
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &NextTab, w, cx| {
                if !this.tabs.is_empty() {
                    let n = (this.active + 1) % this.tabs.len();
                    this.activate(n, w, cx);
                }
            }))
            .on_action(cx.listener(|this, _: &PrevTab, w, cx| {
                if !this.tabs.is_empty() {
                    let n = (this.active + this.tabs.len() - 1) % this.tabs.len();
                    this.activate(n, w, cx);
                }
            }))
            .on_action(cx.listener(|this, _: &FocusUrl, w, cx| {
                if let Some(TabKind::Request(t)) = this.tabs.get(this.active).map(|t| &t.kind) {
                    let t = t.clone();
                    t.update(cx, |t, cx| t.focus_url(w, cx));
                }
            }))
            .on_action(cx.listener(|this, _: &OpenSettings, w, cx| this.open_settings(None, w, cx)))
            .on_action(cx.listener(|this, _: &SearchRequests, w, cx| {
                this.show_panel(Panel::Collections, cx);
                let sidebar = this.sidebar.clone();
                sidebar.update(cx, |s, cx| s.focus_filter(w, cx));
            }))
            .v_flex()
            .size_full()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .child(self.render_title_bar(cx))
            .child(div().flex_1().min_h_0().h_flex().child(self.render_activity_bar(cx)).child(div().flex_1().h_full().min_w_0().child(body)))
    }
}
