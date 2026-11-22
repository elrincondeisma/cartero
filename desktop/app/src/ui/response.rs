//! Visor de la respuesta: cuerpo (bonito, crudo o imagen), cabeceras, cookies, tiempos, tests
//! y consola de los scripts.

use std::sync::Arc;

use cartero_runner::Outcome;
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::input::{Editor, EditorState};
use gpui_kit::component::notification::Notification;
use gpui_kit::component::tab::{Tab, TabBar};

use crate::ui::prelude::*;
use crate::ui::widgets::{empty_state, human_ms, human_size};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Section {
    Body,
    Headers,
    Cookies,
    Timings,
    Tests,
    Console,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum BodyMode {
    Pretty,
    Raw,
    Preview,
}

pub struct ResponseView {
    outcome: Option<Outcome>,
    section: Section,
    mode: BodyMode,
    body: Entity<EditorState>,
    pretty: String,
    raw: String,
    image: Option<Arc<Image>>,
    language: &'static str,
    highlight_limit: usize,
    sending: bool,
}

fn language_for(content_type: &str, body: &str) -> &'static str {
    let ct = content_type.to_lowercase();
    if ct.contains("json") {
        "json"
    } else if ct.contains("html") || ct.contains("xml") {
        "html"
    } else if ct.contains("javascript") {
        "javascript"
    } else if ct.contains("yaml") {
        "yaml"
    } else {
        let t = body.trim_start();
        if t.starts_with('{') || t.starts_with('[') {
            "json"
        } else if t.starts_with('<') {
            "html"
        } else {
            "text"
        }
    }
}

fn image_format(content_type: &str) -> Option<ImageFormat> {
    let ct = content_type.to_lowercase();
    Some(if ct.contains("png") {
        ImageFormat::Png
    } else if ct.contains("jpeg") || ct.contains("jpg") {
        ImageFormat::Jpeg
    } else if ct.contains("gif") {
        ImageFormat::Gif
    } else if ct.contains("webp") {
        ImageFormat::Webp
    } else if ct.contains("svg") {
        ImageFormat::Svg
    } else if ct.contains("bmp") {
        ImageFormat::Bmp
    } else {
        return None;
    })
}

/// JSON con sangría; si no es JSON válido, tal cual.
pub fn pretty_json(text: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    serde_json::to_string_pretty(&v).ok()
}

impl ResponseView {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let body = cx.new(|cx| {
            let mut s = EditorState::new(window, cx).language("json".to_string()).line_number(true).soft_wrap(true).default_value("");
            s.set_readonly(true, cx);
            s
        });
        Self {
            outcome: None,
            section: Section::Body,
            mode: BodyMode::Pretty,
            body,
            pretty: String::new(),
            raw: String::new(),
            image: None,
            language: "text",
            highlight_limit: 2 * 1024 * 1024,
            sending: false,
        }
    }

    pub fn set_sending(&mut self, sending: bool, cx: &mut Context<Self>) {
        self.sending = sending;
        cx.notify();
    }

    pub fn set_highlight_limit(&mut self, kb: u64) {
        self.highlight_limit = (kb as usize).saturating_mul(1024).max(64 * 1024);
    }

    pub fn set_outcome(&mut self, outcome: Option<Outcome>, window: &mut Window, cx: &mut Context<Self>) {
        self.sending = false;
        self.image = None;
        self.raw.clear();
        self.pretty.clear();
        if let Some(res) = outcome.as_ref().and_then(|o| o.response.as_ref()) {
            let ct = res.header("content-type").unwrap_or_default().to_string();
            if let Some(fmt) = image_format(&ct) {
                self.image = Some(Arc::new(Image::from_bytes(fmt, res.body.to_vec())));
                self.mode = BodyMode::Preview;
            } else if self.mode == BodyMode::Preview {
                self.mode = BodyMode::Pretty;
            }
            self.raw = res.text();
            self.language = language_for(&ct, &self.raw);
            self.pretty = if self.language == "json" && self.raw.len() < 20 * 1024 * 1024 {
                pretty_json(&self.raw).unwrap_or_else(|| self.raw.clone())
            } else {
                self.raw.clone()
            };
            // Sin pruebas o tests, mejor ver el cuerpo; si fallan tests, se queda donde estaba
        } else if outcome.as_ref().is_some_and(|o| o.error.is_some()) {
            self.section = Section::Body;
        }
        if let Some(o) = &outcome
            && self.section == Section::Tests
            && o.tests.is_empty()
        {
            self.section = Section::Body;
        }
        self.outcome = outcome;
        self.refresh_body(window, cx);
        cx.notify();
    }

    fn refresh_body(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let text = if self.mode == BodyMode::Raw { self.raw.clone() } else { self.pretty.clone() };
        let lang = if text.len() > self.highlight_limit || self.mode == BodyMode::Raw { "text" } else { self.language };
        self.body.update(cx, |s, cx| {
            s.set_highlighter(lang, cx);
            s.set_value(text, window, cx);
        });
    }

    fn set_mode(&mut self, mode: BodyMode, window: &mut Window, cx: &mut Context<Self>) {
        self.mode = mode;
        if mode != BodyMode::Preview {
            self.refresh_body(window, cx);
        }
        cx.notify();
    }

    fn copy_body(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        cx.write_to_clipboard(ClipboardItem::new_string(if self.mode == BodyMode::Raw { self.raw.clone() } else { self.pretty.clone() }));
        window.push_notification(Notification::success(tr("Cuerpo copiado")), cx);
    }

    fn save_body(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(res) = self.outcome.as_ref().and_then(|o| o.response.clone()) else { return };
        let ext = match self.language {
            "json" => "json",
            "html" => "html",
            _ => "txt",
        };
        let dir = dirs::download_dir().unwrap_or_else(std::env::temp_dir);
        let rx = cx.prompt_for_new_path(&dir, Some(&format!("respuesta.{ext}")));
        cx.spawn_in(window, async move |_, cx| {
            if let Ok(Ok(Some(path))) = rx.await {
                let ok = std::fs::write(&path, &res.body).is_ok();
                let _ = cx.update(|window, cx| {
                    if ok {
                        window.push_notification(Notification::success(tr("Respuesta guardada")), cx);
                    } else {
                        window.push_notification(Notification::error(tr("No se pudo guardar el fichero")), cx);
                    }
                });
            }
        })
        .detach();
    }

    fn open_in_browser(&mut self, _: &mut Window, _: &mut Context<Self>) {
        let path = std::env::temp_dir().join(format!("cartero-respuesta-{}.html", std::process::id()));
        if std::fs::write(&path, &self.raw).is_ok() {
            let _ = open::that(path);
        }
    }

    fn render_status(&self, cx: &Context<Self>) -> impl IntoElement + use<> {
        let muted = cx.theme().muted_foreground;
        let Some(o) = &self.outcome else { return div().h_flex() };
        let Some(r) = &o.response else {
            return div()
                .h_flex()
                .gap_2()
                .text_sm()
                .text_color(cx.theme().danger)
                .child(Icon::new(IconName::CircleX))
                .child(tr("Sin respuesta"));
        };
        let stat = |label: SharedString, value: String, color: Option<Hsla>| {
            div()
                .h_flex()
                .gap_1()
                .child(div().text_color(muted).child(label))
                .child(div().font_semibold().when_some(color, |d, c| d.text_color(c)).child(value))
        };
        let passed = o.tests.iter().filter(|t| t.passed).count();
        div()
            .h_flex()
            .gap_4()
            .text_sm()
            .child(stat(tr("Estado"), format!("{} {}", r.status, r.reason), Some(crate::theme::status_color(r.status, cx))))
            .child(stat(tr("Tiempo"), human_ms(r.timings.total), None))
            .child(stat(tr("Tamaño"), human_size(r.body_size + r.headers_size), None))
            .when(!o.tests.is_empty(), |d| {
                let color = if passed == o.tests.len() { crate::theme::status_color(200, cx) } else { cx.theme().danger };
                d.child(stat(tr("Tests"), format!("{passed}/{}", o.tests.len()), Some(color)))
            })
    }

    fn render_body(&self, cx: &mut Context<Self>) -> AnyElement {
        let Some(o) = &self.outcome else { return div().into_any_element() };
        if o.response.is_none() {
            let msg = o.error.clone().unwrap_or_else(|| tr("La petición no se envió (un script la saltó).").to_string());
            return empty_state(IconName::CloudOff, tr("No se pudo completar la petición"), msg.into(), cx)
                .child(
                    div()
                        .text_xs()
                        .text_color(cx.theme().muted_foreground)
                        .child(tr("Revisa la URL, que el servidor esté en marcha y los ajustes de proxy y certificados.")),
                )
                .into_any_element();
        }
        let mode_btn = |id: &'static str, label: SharedString, mode: BodyMode, cx: &mut Context<Self>| {
            Button::new(id)
                .small()
                .ghost()
                .selected(self.mode == mode)
                .label(label)
                .on_click(cx.listener(move |this, _, window, cx| this.set_mode(mode, window, cx)))
        };
        let toolbar = div()
            .h_flex()
            .gap_1()
            .px_2()
            .py_1()
            .child(mode_btn("mode-pretty", tr("Bonito"), BodyMode::Pretty, cx))
            .child(mode_btn("mode-raw", tr("Crudo"), BodyMode::Raw, cx))
            .when(self.image.is_some(), |d| d.child(mode_btn("mode-preview", tr("Vista previa"), BodyMode::Preview, cx)))
            .child(div().flex_1())
            .when(self.language == "html", |d| {
                d.child(
                    Button::new("open-browser")
                        .small()
                        .ghost()
                        .icon(IconName::ExternalLink)
                        .tooltip(tr("Abrir en el navegador"))
                        .on_click(cx.listener(|this, _, w, cx| this.open_in_browser(w, cx))),
                )
            })
            .child(
                Button::new("copy-body")
                    .small()
                    .ghost()
                    .icon(IconName::Copy)
                    .tooltip(tr("Copiar"))
                    .on_click(cx.listener(|this, _, w, cx| this.copy_body(w, cx))),
            )
            .child(
                Button::new("save-body")
                    .small()
                    .ghost()
                    .icon(IconName::Download)
                    .tooltip(tr("Guardar en un fichero"))
                    .on_click(cx.listener(|this, _, w, cx| this.save_body(w, cx))),
            );
        let content: AnyElement = match (&self.image, self.mode) {
            (Some(image), BodyMode::Preview) => {
                div().size_full().p_4().flex().justify_center().child(img(image.clone()).max_w_full().max_h_full()).into_any_element()
            }
            _ => Editor::new(&self.body).h_full().bordered(false).into_any_element(),
        };
        div().v_flex().size_full().child(toolbar).child(div().flex_1().min_h_0().child(content)).into_any_element()
    }

    fn render_headers(&self, cx: &Context<Self>) -> AnyElement {
        let Some(r) = self.outcome.as_ref().and_then(|o| o.response.as_ref()) else { return div().into_any_element() };
        kv_table(r.headers.iter().map(|(k, v)| (k.clone(), v.clone())).collect(), cx).into_any_element()
    }

    fn render_cookies(&self, cx: &Context<Self>) -> AnyElement {
        let Some(r) = self.outcome.as_ref().and_then(|o| o.response.as_ref()) else { return div().into_any_element() };
        let cookies: Vec<(String, String)> = r
            .headers
            .iter()
            .filter(|(k, _)| k.eq_ignore_ascii_case("set-cookie"))
            .map(|(_, v)| {
                let (nv, attrs) = v.split_once(';').unwrap_or((v, ""));
                let (n, val) = nv.split_once('=').unwrap_or((nv, ""));
                (
                    n.trim().to_string(),
                    format!("{}{}", val.trim(), if attrs.is_empty() { String::new() } else { format!("  ·  {}", attrs.trim()) }),
                )
            })
            .collect();
        if cookies.is_empty() {
            return empty_state(
                IconName::Cookie,
                tr("Sin cookies"),
                tr("La respuesta no ha enviado ninguna cookie (cabecera Set-Cookie)."),
                cx,
            )
            .into_any_element();
        }
        kv_table(cookies, cx).into_any_element()
    }

    fn render_timings(&self, cx: &Context<Self>) -> AnyElement {
        let Some(r) = self.outcome.as_ref().and_then(|o| o.response.as_ref()) else { return div().into_any_element() };
        let t = &r.timings;
        let phases = [
            (tr("Búsqueda DNS"), t.dns),
            (tr("Conexión TCP"), t.tcp),
            (tr("Negociación TLS"), t.tls),
            (tr("Espera (primer byte)"), t.first_byte),
            (tr("Descarga"), t.download),
        ];
        let total = t.total.as_secs_f64().max(0.000_001);
        let mut offset = 0.0;
        let brand = crate::theme::brand();
        let muted = cx.theme().muted_foreground;
        let rows = phases.into_iter().map(|(label, d)| {
            let start = offset / total;
            let width = (d.as_secs_f64() / total).max(0.003);
            offset += d.as_secs_f64();
            div()
                .h_flex()
                .gap_3()
                .h_7()
                .child(div().w(px(170.)).text_sm().text_color(muted).child(label))
                .child(div().flex_1().h_2().relative().rounded_full().bg(cx.theme().muted).child(
                    div().absolute().top_0().bottom_0().left(relative(start as f32)).w(relative(width as f32)).rounded_full().bg(brand),
                ))
                .child(div().w(px(80.)).text_sm().text_right().child(human_ms(d)))
        });
        let mut info = vec![
            (tr("Total"), human_ms(t.total)),
            (tr("Dirección remota"), r.remote_addr.to_string()),
            (tr("HTTP"), r.http_version.clone()),
        ];
        if let Some(tls) = &r.tls {
            info.push((tr("TLS"), format!("{} · {}", tls.protocol, tls.cipher)));
        }
        if !r.redirects.is_empty() {
            info.push((tr("Redirecciones"), r.redirects.len().to_string()));
        }
        div()
            .v_flex()
            .p_4()
            .gap_1()
            .children(rows)
            .child(div().h_3())
            .children(
                info.into_iter()
                    .map(|(k, v)| div().h_flex().gap_3().text_sm().child(div().w(px(170.)).text_color(muted).child(k)).child(v)),
            )
            .into_any_element()
    }

    fn render_tests(&self, cx: &Context<Self>) -> AnyElement {
        let Some(o) = &self.outcome else { return div().into_any_element() };
        if o.tests.is_empty() && o.script_errors.is_empty() {
            return empty_state(
                IconName::FlaskConical,
                tr("Sin tests"),
                tr("Escribe tests en Scripts → Después de la respuesta, por ejemplo: pm.test(\"Responde 200\", () => pm.response.to.have.status(200))"),
                cx,
            )
            .into_any_element();
        }
        let ok = crate::theme::status_color(200, cx);
        let bad = cx.theme().danger;
        let muted = cx.theme().muted_foreground;
        div()
            .v_flex()
            .p_3()
            .gap_1()
            .children(o.script_errors.iter().map(|e| {
                div()
                    .h_flex()
                    .items_start()
                    .gap_2()
                    .text_sm()
                    .text_color(bad)
                    .child(Icon::new(IconName::TriangleAlert))
                    .child(div().flex_1().child(e.clone()))
            }))
            .children(o.tests.iter().map(|t| {
                let (icon, color) = if t.skipped {
                    (IconName::Minus, muted)
                } else if t.passed {
                    (IconName::CircleCheck, ok)
                } else {
                    (IconName::CircleX, bad)
                };
                div()
                    .v_flex()
                    .py_1()
                    .child(div().h_flex().gap_2().text_sm().child(div().text_color(color).child(Icon::new(icon))).child(t.name.clone()))
                    .when_some(t.error.clone().filter(|_| !t.passed), |d, e| d.child(div().pl_6().text_xs().text_color(bad).child(e)))
            }))
            .into_any_element()
    }

    fn render_console(&self, cx: &Context<Self>) -> AnyElement {
        let Some(o) = &self.outcome else { return div().into_any_element() };
        let muted = cx.theme().muted_foreground;
        let mut lines: Vec<AnyElement> = vec![];
        lines.push(
            div()
                .h_flex()
                .gap_2()
                .text_xs()
                .font_family(cx.theme().mono_font_family.clone())
                .child(div().text_color(crate::theme::method_color(&o.prepared.method, cx)).child(o.prepared.method.clone()))
                .child(o.prepared.url.clone())
                .into_any_element(),
        );
        if let Some(r) = &o.response {
            for (k, v) in &r.request_headers {
                lines.push(
                    div()
                        .pl_4()
                        .text_xs()
                        .text_color(muted)
                        .font_family(cx.theme().mono_font_family.clone())
                        .child(format!("{k}: {v}"))
                        .into_any_element(),
                );
            }
        }
        for e in &o.console {
            let color = match e.level.as_str() {
                "error" => cx.theme().danger,
                "warn" => cx.theme().warning,
                _ => cx.theme().foreground,
            };
            let source: SharedString = match e.source.as_str() {
                "prerequest" => tr("pre"),
                "test" => tr("tests"),
                _ => tr("red"),
            };
            lines.push(
                div()
                    .h_flex()
                    .items_start()
                    .gap_2()
                    .text_xs()
                    .font_family(cx.theme().mono_font_family.clone())
                    .child(div().w(px(44.)).flex_none().text_color(muted).child(source))
                    .child(div().flex_1().text_color(color).child(e.text.clone()))
                    .into_any_element(),
            );
        }
        div().v_flex().p_3().gap_1().children(lines).into_any_element()
    }
}

/// Tabla de dos columnas de solo lectura (cabeceras, cookies).
fn kv_table(rows: Vec<(String, String)>, cx: &App) -> impl IntoElement + use<> {
    let border = cx.theme().border;
    let muted = cx.theme().muted_foreground;
    div().v_flex().p_3().children(rows.into_iter().map(move |(k, v)| {
        div()
            .h_flex()
            .items_start()
            .gap_3()
            .py_1p5()
            .border_b_1()
            .border_color(border)
            .text_sm()
            .child(div().w(px(220.)).flex_none().text_color(muted).child(k))
            .child(div().flex_1().min_w_0().child(v))
    }))
}

impl Render for ResponseView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let muted = cx.theme().muted_foreground;
        if self.sending {
            return div()
                .size_full()
                .v_flex()
                .items_center()
                .justify_center()
                .gap_2()
                .text_color(muted)
                .child(Icon::new(IconName::LoaderCircle).size_6())
                .child(tr("Enviando…"))
                .into_any_element();
        }
        let Some(o) = &self.outcome else {
            return empty_state(
                IconName::Send,
                tr("Aún no hay respuesta"),
                tr("Escribe una URL y pulsa Enviar (Ctrl+Intro). La respuesta aparecerá aquí."),
                cx,
            )
            .into_any_element();
        };
        let counts = (
            o.response.as_ref().map(|r| r.headers.len()).unwrap_or(0),
            o.response.as_ref().map(|r| r.headers.iter().filter(|(k, _)| k.eq_ignore_ascii_case("set-cookie")).count()).unwrap_or(0),
            o.tests.len(),
            o.console.len(),
        );
        let sections = [
            (Section::Body, tr("Cuerpo"), None),
            (Section::Headers, tr("Cabeceras"), Some(counts.0)),
            (Section::Cookies, tr("Cookies"), Some(counts.1)),
            (Section::Timings, tr("Tiempos"), None),
            (Section::Tests, tr("Tests"), Some(counts.2)),
            (Section::Console, tr("Consola"), Some(counts.3)),
        ];
        let selected = sections.iter().position(|(s, _, _)| *s == self.section).unwrap_or(0);
        let tabs = TabBar::new("response-tabs")
            .underline()
            .selected_index(selected)
            .children(sections.iter().map(|(_, label, count)| {
                let text: SharedString = match count {
                    Some(n) if *n > 0 => format!("{label} ({n})").into(),
                    _ => label.clone(),
                };
                Tab::new().label(text)
            }))
            .on_click(cx.listener(move |this, ix: &usize, _, cx| {
                this.section = sections[*ix].0;
                cx.notify();
            }));
        let content = match self.section {
            Section::Body => self.render_body(cx),
            Section::Headers => self.render_headers(cx),
            Section::Cookies => self.render_cookies(cx),
            Section::Timings => self.render_timings(cx),
            Section::Tests => self.render_tests(cx),
            Section::Console => self.render_console(cx),
        };
        div()
            .v_flex()
            .size_full()
            .child(div().h_flex().justify_between().pr_3().child(tabs).child(self.render_status(cx)))
            .child(
                div()
                    .id("response-content")
                    .flex_1()
                    .min_h_0()
                    .when(self.section != Section::Body, |d| d.overflow_y_scroll())
                    .child(content),
            )
            .into_any_element()
    }
}
