//! Tabla editable de clave/valor: parámetros, cabeceras, cuerpos de formulario y variables.
//! Siempre hay una fila vacía al final; al escribir en ella aparece otra.

use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::checkbox::Checkbox;
use gpui_kit::component::input::{Input, InputEvent, InputState};

use crate::ui::prelude::*;

/// Una fila, independiente del tipo (cabecera, parámetro, variable, campo de formulario).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct KvItem {
    pub key: String,
    pub value: String,
    pub description: String,
    pub enabled: bool,
    /// Variables: es secreta. Formularios: es un fichero.
    pub flag: bool,
}

impl KvItem {
    pub fn new(key: impl Into<String>, value: impl Into<String>) -> Self {
        Self { key: key.into(), value: value.into(), enabled: true, ..Default::default() }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum FlagKind {
    None,
    /// Variables: mostrar/ocultar y marcar como secreta
    Secret,
    /// form-data: texto o fichero
    File,
}

#[derive(Clone)]
pub struct KvOptions {
    pub key_placeholder: SharedString,
    pub value_placeholder: SharedString,
    pub description: bool,
    pub flag: FlagKind,
    pub checkbox: bool,
}

impl Default for KvOptions {
    fn default() -> Self {
        Self { key_placeholder: tr("Clave"), value_placeholder: tr("Valor"), description: true, flag: FlagKind::None, checkbox: true }
    }
}

struct Row {
    enabled: bool,
    flag: bool,
    key: Entity<InputState>,
    value: Entity<InputState>,
    description: Entity<InputState>,
}

pub struct KvChanged;

pub struct KvEditor {
    rows: Vec<Row>,
    opts: KvOptions,
    readonly: bool,
    _subs: Vec<Subscription>,
}

impl EventEmitter<KvChanged> for KvEditor {}

impl KvEditor {
    pub fn new(items: Vec<KvItem>, opts: KvOptions, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let mut this = Self { rows: vec![], opts, readonly: false, _subs: vec![] };
        this.set_items(items, window, cx);
        this
    }

    pub fn readonly(mut self, readonly: bool) -> Self {
        self.readonly = readonly;
        self
    }

    fn make_row(&mut self, item: KvItem, window: &mut Window, cx: &mut Context<Self>) -> Row {
        let opts = self.opts.clone();
        let key = cx.new(|cx| InputState::new(window, cx).placeholder(opts.key_placeholder.clone()).default_value(item.key.clone()));
        let masked = opts.flag == FlagKind::Secret && item.flag;
        let value = cx.new(|cx| {
            let s = InputState::new(window, cx).placeholder(opts.value_placeholder.clone()).default_value(item.value.clone());
            if masked { s.masked(true) } else { s }
        });
        let description = cx.new(|cx| InputState::new(window, cx).placeholder(tr("Descripción")).default_value(item.description.clone()));
        for input in [&key, &value, &description] {
            let sub = cx.subscribe_in(input, window, |this, _, ev: &InputEvent, window, cx| {
                if matches!(ev, InputEvent::Change) {
                    this.ensure_trailing(window, cx);
                    cx.emit(KvChanged);
                    cx.notify();
                }
            });
            self._subs.push(sub);
        }
        Row { enabled: item.enabled, flag: item.flag, key, value, description }
    }

    /// Cambia el contenido sin emitir `KvChanged` (lo usa quien sincroniza, p. ej. URL ↔ parámetros).
    pub fn set_items(&mut self, items: Vec<KvItem>, window: &mut Window, cx: &mut Context<Self>) {
        self._subs.clear();
        self.rows.clear();
        for item in items {
            let row = self.make_row(item, window, cx);
            self.rows.push(row);
        }
        self.ensure_trailing(window, cx);
        cx.notify();
    }

    fn ensure_trailing(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.readonly {
            return;
        }
        let needs = self.rows.last().is_none_or(|r| !r.key.read(cx).value().is_empty() || !r.value.read(cx).value().is_empty());
        if needs {
            let row = self.make_row(KvItem { enabled: true, ..Default::default() }, window, cx);
            self.rows.push(row);
        }
    }

    pub fn items(&self, cx: &App) -> Vec<KvItem> {
        self.rows
            .iter()
            .map(|r| KvItem {
                key: r.key.read(cx).value().to_string(),
                value: r.value.read(cx).value().to_string(),
                description: r.description.read(cx).value().to_string(),
                enabled: r.enabled,
                flag: r.flag,
            })
            .filter(|i| !i.key.is_empty() || !i.value.is_empty() || !i.description.is_empty())
            .collect()
    }

    /// Número de filas con contenido y activadas (para el contador de la pestaña).
    pub fn count(&self, cx: &App) -> usize {
        self.items(cx).iter().filter(|i| i.enabled && !i.key.is_empty()).count()
    }

    fn remove(&mut self, ix: usize, window: &mut Window, cx: &mut Context<Self>) {
        if ix < self.rows.len() {
            self.rows.remove(ix);
            self.ensure_trailing(window, cx);
            cx.emit(KvChanged);
            cx.notify();
        }
    }

    fn pick_file(&mut self, ix: usize, window: &mut Window, cx: &mut Context<Self>) {
        let rx =
            cx.prompt_for_paths(PathPromptOptions { files: true, directories: false, multiple: false, prompt: Some(tr("Elegir fichero")) });
        cx.spawn_in(window, async move |this, cx| {
            if let Ok(Ok(Some(paths))) = rx.await
                && let Some(p) = paths.first()
            {
                let path = p.to_string_lossy().to_string();
                let _ = this.update_in(cx, |this, window, cx| {
                    if let Some(row) = this.rows.get_mut(ix) {
                        row.flag = true;
                        row.value.update(cx, |s, cx| s.set_value(path, window, cx));
                        this.ensure_trailing(window, cx);
                        cx.emit(KvChanged);
                        cx.notify();
                    }
                });
            }
        })
        .detach();
    }
}

impl Render for KvEditor {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let border = cx.theme().border;
        let muted = cx.theme().muted_foreground;
        let last = self.rows.len().saturating_sub(1);
        let opts = self.opts.clone();
        let readonly = self.readonly;
        let header = div()
            .h_flex()
            .h_7()
            .border_b_1()
            .border_color(border)
            .text_xs()
            .text_color(muted)
            .when(opts.checkbox, |d| d.child(div().w_8()))
            .child(div().flex_1().px_2().child(tr("Clave")))
            .child(div().flex_1().px_2().child(tr("Valor")))
            .when(opts.description, |d| d.child(div().flex_1().px_2().child(tr("Descripción"))))
            .child(div().w(px(if opts.flag == FlagKind::None { 32. } else { 64. })));

        let rows = self.rows.iter().enumerate().map(|(ix, row)| {
            let is_trailing = ix == last && !readonly;
            let enabled = row.enabled;
            let flag = row.flag;
            div()
                .id(("kv-row", ix))
                .h_flex()
                .min_h_8()
                .border_b_1()
                .border_color(border)
                .when(!enabled && !is_trailing, |d| d.opacity(0.55))
                .when(opts.checkbox, |d| {
                    d.child(div().w_8().flex().justify_center().when(!is_trailing, |d| {
                        d.child(Checkbox::new(("kv-check", ix)).checked(enabled).small().on_click(cx.listener(
                            move |this, checked: &bool, _, cx| {
                                if let Some(r) = this.rows.get_mut(ix) {
                                    r.enabled = *checked;
                                    cx.emit(KvChanged);
                                    cx.notify();
                                }
                            },
                        )))
                    }))
                })
                .child(div().flex_1().min_w_0().child(Input::new(&row.key).small().appearance(false).disabled(readonly)))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .border_l_1()
                        .border_color(border)
                        .child(Input::new(&row.value).small().appearance(false).disabled(readonly)),
                )
                .when(opts.description, |d| {
                    d.child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .border_l_1()
                            .border_color(border)
                            .child(Input::new(&row.description).small().appearance(false).disabled(readonly)),
                    )
                })
                .child(
                    div()
                        .w(px(if opts.flag == FlagKind::None { 32. } else { 64. }))
                        .h_flex()
                        .justify_end()
                        .gap_0p5()
                        .pr_1()
                        .when(!is_trailing && !readonly && opts.flag == FlagKind::Secret, |d| {
                            d.child(
                                Button::new(("kv-secret", ix))
                                    .ghost()
                                    .xsmall()
                                    .icon(if flag { IconName::EyeOff } else { IconName::Eye })
                                    .tooltip(if flag {
                                        tr("Secreta: el valor se oculta y se guarda cifrado")
                                    } else {
                                        tr("Marcar como secreta")
                                    })
                                    .on_click(cx.listener(move |this, _, window, cx| {
                                        if let Some(r) = this.rows.get_mut(ix) {
                                            r.flag = !r.flag;
                                            let masked = r.flag;
                                            r.value.update(cx, |s, cx| s.set_masked(masked, window, cx));
                                            cx.emit(KvChanged);
                                            cx.notify();
                                        }
                                    })),
                            )
                        })
                        .when(!readonly && opts.flag == FlagKind::File, |d| {
                            d.child(
                                Button::new(("kv-file", ix))
                                    .ghost()
                                    .xsmall()
                                    .icon(if flag { IconName::File } else { IconName::Upload })
                                    .tooltip(if flag { tr("Fichero (pulsa para cambiarlo)") } else { tr("Enviar un fichero") })
                                    .on_click(cx.listener(move |this, _, window, cx| this.pick_file(ix, window, cx))),
                            )
                        })
                        .when(!is_trailing && !readonly, |d| {
                            d.child(
                                Button::new(("kv-del", ix))
                                    .ghost()
                                    .xsmall()
                                    .icon(IconName::X)
                                    .tooltip(tr("Quitar"))
                                    .on_click(cx.listener(move |this, _, window, cx| this.remove(ix, window, cx))),
                            )
                        }),
                )
        });
        div().v_flex().w_full().border_1().border_color(border).rounded(cx.theme().radius).child(header).children(rows)
    }
}
