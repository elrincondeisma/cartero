//! Ajustes de una colección o carpeta: autenticación, scripts, variables y descripción.

use cartero_model::{script_of, set_script};
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::input::{Editor, EditorState, InputEvent};
use gpui_kit::component::notification::Notification;
use gpui_kit::component::tab::{Tab, TabBar};
use serde_json::Value;

use crate::state::AppState;
use crate::ui::auth::{AuthChanged, AuthEditor};
use crate::ui::environment::{kv_to_vars, vars_to_kv};
use crate::ui::kv::{FlagKind, KvChanged, KvEditor, KvOptions};
use crate::ui::prelude::*;
use crate::ui::request::TabEvent;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Section {
    Auth,
    Pre,
    Post,
    Variables,
    Docs,
}

pub struct CollectionTab {
    app: Entity<AppState>,
    pub collection_id: String,
    pub folder_id: Option<String>,
    name: String,
    section: Section,
    auth: Entity<AuthEditor>,
    pre: Entity<EditorState>,
    post: Entity<EditorState>,
    vars: Entity<KvEditor>,
    docs: Entity<EditorState>,
    pub dirty: bool,
    focus: FocusHandle,
    _subs: Vec<Subscription>,
}

impl EventEmitter<TabEvent> for CollectionTab {}

impl CollectionTab {
    pub fn new(
        app: Entity<AppState>,
        collection_id: String,
        folder_id: Option<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let c = app.read(cx).store.collection(&collection_id).unwrap_or_default();
        let folder = folder_id.as_ref().and_then(|f| cartero_model::tree::find(&c.item, f).cloned());
        let (name, auth, events, variables, description) = match &folder {
            Some(f) => (f.name.clone(), f.auth.clone().flatten(), f.event.clone(), None, f.description.clone()),
            None => (c.info.name.clone(), c.auth.clone().flatten(), c.event.clone(), c.variable.clone(), c.info.description.clone()),
        };
        let allow_inherit = folder.is_some();
        let auth_value = auth.filter(|a| !a.is_inherit());
        let auth = cx.new(|cx| AuthEditor::new(app.clone(), Some(collection_id.clone()), auth_value, allow_inherit, window, cx));
        let ed = |v: String, lang: &str, window: &mut Window, cx: &mut Context<Self>| {
            let lang = lang.to_string();
            cx.new(|cx| EditorState::new(window, cx).language(lang).line_number(true).soft_wrap(true).default_value(v))
        };
        let pre = ed(script_of(&events, "prerequest").unwrap_or_default(), "javascript", window, cx);
        let post = ed(script_of(&events, "test").unwrap_or_default(), "javascript", window, cx);
        let docs = ed(cartero_model::description_text(&description), "text", window, cx);
        let vars = cx.new(|cx| {
            KvEditor::new(
                vars_to_kv(variables.as_deref().unwrap_or_default()),
                KvOptions { key_placeholder: tr("Variable"), flag: FlagKind::Secret, ..Default::default() },
                window,
                cx,
            )
        });
        let mut subs = vec![];
        subs.push(cx.subscribe_in(&auth, window, |this, _, _: &AuthChanged, _, cx| this.mark_dirty(cx)));
        subs.push(cx.subscribe_in(&vars, window, |this, _, _: &KvChanged, _, cx| this.mark_dirty(cx)));
        for e in [pre.clone(), post.clone(), docs.clone()] {
            subs.push(cx.subscribe_in(&e, window, |this, _, ev: &InputEvent, _, cx| {
                if matches!(ev, InputEvent::Change) {
                    this.mark_dirty(cx)
                }
            }));
        }
        Self {
            app,
            collection_id,
            folder_id,
            name,
            section: Section::Auth,
            auth,
            pre,
            post,
            vars,
            docs,
            dirty: false,
            focus: cx.focus_handle(),
            _subs: subs,
        }
    }

    fn mark_dirty(&mut self, cx: &mut Context<Self>) {
        if !self.dirty {
            self.dirty = true;
            cx.emit(TabEvent::Changed);
        }
        cx.notify();
    }

    pub fn title(&self) -> SharedString {
        self.name.clone().into()
    }

    pub fn save(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let store = self.app.read(cx).store.clone();
        let Ok(mut c) = store.collection(&self.collection_id) else { return };
        let auth = self.auth.read(cx).value(cx);
        let pre = self.pre.read(cx).value().to_string();
        let post = self.post.read(cx).value().to_string();
        let docs = self.docs.read(cx).value().to_string();
        let docs = (!docs.trim().is_empty()).then(|| Value::String(docs));
        let result = match &self.folder_id {
            Some(fid) => match cartero_model::tree::find(&c.item, fid).cloned() {
                Some(mut f) => {
                    f.auth = auth.map(Some);
                    set_script(&mut f.event, "prerequest", &pre);
                    set_script(&mut f.event, "test", &post);
                    f.description = docs;
                    store.save_item(&f)
                }
                None => return,
            },
            None => {
                c.auth = auth.map(Some);
                set_script(&mut c.event, "prerequest", &pre);
                set_script(&mut c.event, "test", &post);
                let vars = kv_to_vars(self.vars.read(cx).items(cx), c.variable.as_deref().unwrap_or_default());
                c.variable = (!vars.is_empty()).then_some(vars);
                c.info.description = docs;
                store.save_collection_meta(&c)
            }
        };
        match result {
            Ok(()) => {
                self.dirty = false;
                self.app.update(cx, |a, cx| a.reload_collections(cx));
                window.push_notification(Notification::success(tr("Guardado")), cx);
                cx.emit(TabEvent::Changed);
            }
            Err(e) => window.push_notification(Notification::error(e.to_string()), cx),
        }
        cx.notify();
    }
}

impl Focusable for CollectionTab {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl Render for CollectionTab {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let muted = cx.theme().muted_foreground;
        let is_folder = self.folder_id.is_some();
        let mut sections = vec![
            (Section::Auth, tr("Autorización")),
            (Section::Pre, tr("Antes de enviar")),
            (Section::Post, tr("Después de la respuesta")),
        ];
        if !is_folder {
            sections.push((Section::Variables, tr("Variables")));
        }
        sections.push((Section::Docs, tr("Descripción")));
        let selected = sections.iter().position(|(s, _)| *s == self.section).unwrap_or(0);
        let ids: Vec<Section> = sections.iter().map(|(s, _)| *s).collect();
        let tabs = TabBar::new("collection-sections")
            .underline()
            .selected_index(selected)
            .children(sections.into_iter().map(|(_, l)| Tab::new().label(l)))
            .on_click(cx.listener(move |this, ix: &usize, _, cx| {
                this.section = ids[*ix];
                cx.notify();
            }));
        let help = match self.section {
            Section::Auth => tr("Las peticiones que hereden la autenticación usarán esta."),
            Section::Pre => tr("Se ejecuta antes de cada petición de dentro, antes que el script de la propia petición."),
            Section::Post => tr("Se ejecuta tras cada petición de dentro: útil para tests comunes a todas."),
            Section::Variables => tr("Variables de colección: valen para todas sus peticiones. Las del entorno activo tienen prioridad."),
            Section::Docs => tr("Descripción en Markdown."),
        };
        let content: AnyElement = match self.section {
            Section::Auth => self.auth.clone().into_any_element(),
            Section::Pre => div().size_full().child(Editor::new(&self.pre).h_full()).into_any_element(),
            Section::Post => div().size_full().child(Editor::new(&self.post).h_full()).into_any_element(),
            Section::Variables => div().p_3().child(self.vars.clone()).into_any_element(),
            Section::Docs => div().size_full().child(Editor::new(&self.docs).h_full()).into_any_element(),
        };
        div()
            .track_focus(&self.focus)
            .size_full()
            .v_flex()
            .child(
                div()
                    .h_flex()
                    .gap_3()
                    .px_4()
                    .pt_4()
                    .pb_2()
                    .child(Icon::new(if is_folder { IconName::Folder } else { IconName::Package }).size_5())
                    .child(div().text_lg().font_semibold().child(self.name.clone()))
                    .child(div().flex_1())
                    .child(
                        Button::new("col-save")
                            .primary()
                            .small()
                            .icon(IconName::Save)
                            .label(tr("Guardar"))
                            .disabled(!self.dirty)
                            .on_click(cx.listener(|this, _, w, cx| this.save(w, cx))),
                    ),
            )
            .child(div().px_2().child(tabs))
            .child(div().px_4().py_2().text_sm().text_color(muted).child(help))
            .child(div().id("col-content").flex_1().min_h_0().overflow_y_scroll().child(content))
    }
}
