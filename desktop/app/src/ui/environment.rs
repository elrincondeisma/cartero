//! Editor de un entorno o de las variables globales.

use cartero_model::{Environment, Variable};
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::notification::Notification;
use serde_json::Value;

use crate::state::{AppState, StateEvent};
use crate::ui::kv::{FlagKind, KvChanged, KvEditor, KvItem, KvOptions};
use crate::ui::prelude::*;
use crate::ui::request::TabEvent;

pub fn vars_to_kv(values: &[Variable]) -> Vec<KvItem> {
    values
        .iter()
        .map(|v| KvItem { key: v.key.clone(), value: v.value_str(), description: cartero_model::description_text(&v.description), enabled: !v.disabled, flag: v.is_secret() })
        .collect()
}

pub fn kv_to_vars(items: Vec<KvItem>, base: &[Variable]) -> Vec<Variable> {
    items
        .into_iter()
        .map(|i| {
            let mut v = base.iter().find(|b| b.key == i.key).cloned().unwrap_or_default();
            v.key = i.key;
            v.value = Some(Value::String(i.value));
            v.disabled = !i.enabled;
            v.kind = if i.flag { Some("secret".into()) } else { v.kind.filter(|k| k != "secret") };
            v.description = (!i.description.is_empty()).then(|| Value::String(i.description));
            v
        })
        .collect()
}

/// None = variables globales del workspace.
pub struct EnvironmentTab {
    app: Entity<AppState>,
    pub env_id: Option<String>,
    base: Vec<Variable>,
    name: Entity<InputState>,
    vars: Entity<KvEditor>,
    pub dirty: bool,
    focus: FocusHandle,
    _subs: Vec<Subscription>,
}

impl EventEmitter<TabEvent> for EnvironmentTab {}

impl EnvironmentTab {
    pub fn new(app: Entity<AppState>, env_id: Option<String>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let (name, values) = match &env_id {
            Some(id) => app.read(cx).store.environment(id).map(|e| (e.name, e.values)).unwrap_or_default(),
            None => (tr("Variables globales").to_string(), app.read(cx).globals.clone()),
        };
        let name_input = cx.new(|cx| InputState::new(window, cx).default_value(name));
        let vars = cx.new(|cx| KvEditor::new(vars_to_kv(&values), KvOptions { key_placeholder: tr("Variable"), flag: FlagKind::Secret, ..Default::default() }, window, cx));
        let mut subs = vec![];
        subs.push(cx.subscribe_in(&vars, window, |this, _, _: &KvChanged, _, cx| this.mark_dirty(cx)));
        subs.push(cx.subscribe_in(&name_input, window, |this, _, ev: &InputEvent, window, cx| match ev {
            InputEvent::Change => this.mark_dirty(cx),
            InputEvent::PressEnter { .. } => this.save(window, cx),
            _ => {}
        }));
        Self { app, env_id, base: values, name: name_input, vars, dirty: false, focus: cx.focus_handle(), _subs: subs }
    }

    fn mark_dirty(&mut self, cx: &mut Context<Self>) {
        if !self.dirty {
            self.dirty = true;
            cx.emit(TabEvent::Changed);
        }
        cx.notify();
    }

    pub fn title(&self, cx: &App) -> SharedString {
        if self.env_id.is_none() { tr("Variables globales") } else { self.name.read(cx).value().clone() }
    }

    pub fn save(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let values = kv_to_vars(self.vars.read(cx).items(cx), &self.base);
        let store = self.app.read(cx).store.clone();
        let result = match &self.env_id {
            Some(id) => store.save_environment(&Environment { id: Some(id.clone()), name: self.name.read(cx).value().trim().to_string(), values: values.clone() }),
            None => store.save_globals(&self.app.read(cx).workspace.id, &values),
        };
        match result {
            Ok(()) => {
                self.base = values;
                self.dirty = false;
                self.app.update(cx, |a, cx| a.reload_environments(cx));
                window.push_notification(Notification::success(tr("Guardado")), cx);
                cx.emit(TabEvent::Changed);
            }
            Err(e) => window.push_notification(Notification::error(e.to_string()), cx),
        }
        cx.notify();
    }

    /// Recarga si los scripts han cambiado el entorno y aquí no hay cambios sin guardar.
    pub fn on_state(&mut self, ev: &StateEvent, window: &mut Window, cx: &mut Context<Self>) {
        if *ev != StateEvent::Environments || self.dirty {
            return;
        }
        let values = match &self.env_id {
            Some(id) => self.app.read(cx).store.environment(id).map(|e| e.values).unwrap_or_default(),
            None => self.app.read(cx).globals.clone(),
        };
        if values != self.base {
            self.vars.update(cx, |v, cx| v.set_items(vars_to_kv(&values), window, cx));
            self.base = values;
        }
    }
}

impl Focusable for EnvironmentTab {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl Render for EnvironmentTab {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let muted = cx.theme().muted_foreground;
        let is_globals = self.env_id.is_none();
        let is_active = self.env_id.is_some() && self.app.read(cx).active_env == self.env_id;
        div()
            .id("env-tab")
            .track_focus(&self.focus)
            .size_full()
            .overflow_y_scroll()
            .v_flex()
            .gap_4()
            .p_5()
            .child(
                div()
                    .h_flex()
                    .gap_3()
                    .child(Icon::new(if is_globals { IconName::Globe } else { IconName::Layers }).size_5())
                    .child(if is_globals { div().text_lg().font_semibold().child(tr("Variables globales")).into_any_element() } else { div().w(px(320.)).child(Input::new(&self.name)).into_any_element() })
                    .child(div().flex_1())
                    .when(!is_globals && !is_active, |d| {
                        d.child(Button::new("env-activate").outline().small().label(tr("Usar este entorno")).on_click(cx.listener(|this, _, _, cx| {
                            let id = this.env_id.clone();
                            this.app.update(cx, |a, cx| a.set_active_env(id, cx));
                        })))
                    })
                    .child(Button::new("env-save").primary().small().icon(IconName::Save).label(tr("Guardar")).disabled(!self.dirty).on_click(cx.listener(|this, _, w, cx| this.save(w, cx)))),
            )
            .child(div().text_sm().text_color(muted).child(if is_globals {
                tr("Las globales valen en todo el workspace, sea cual sea el entorno. Úsalas con {{nombre}}. Si una variable existe en el entorno activo, gana la del entorno.")
            } else {
                tr("Úsalas en URLs, cabeceras y cuerpos con {{nombre}}. Las secretas se guardan cifradas y no se muestran.")
            }))
            .child(self.vars.clone())
    }
}
