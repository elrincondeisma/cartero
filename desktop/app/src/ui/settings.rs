//! Ajustes de la app: apariencia e idioma, peticiones, proxy, certificados y acerca de.

use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::notification::Notification;
use gpui_kit::component::switch::Switch;

use crate::settings::{CertEntry, Language, Settings, ThemeChoice};
use crate::state::AppState;
use crate::ui::prelude::*;
use crate::ui::request::TabEvent;
use crate::ui::widgets::choice;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Section {
    General,
    Requests,
    Proxy,
    Certificates,
    Servers,
    About,
}

pub struct SettingsTab {
    app: Entity<AppState>,
    pub section: Section,
    draft: Settings,
    timeout: Entity<InputState>,
    max_redirects: Entity<InputState>,
    script_timeout: Entity<InputState>,
    highlight: Entity<InputState>,
    proxy_url: Entity<InputState>,
    proxy_bypass: Entity<InputState>,
    cert_host: Entity<InputState>,
    pending_cert: (Option<String>, Option<String>),
    pub servers: Option<Entity<crate::ui::servers::ServersPanel>>,
    focus: FocusHandle,
    _subs: Vec<Subscription>,
}

impl EventEmitter<TabEvent> for SettingsTab {}

impl SettingsTab {
    pub fn new(app: Entity<AppState>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let s = app.read(cx).settings.clone();
        let input = |v: String, window: &mut Window, cx: &mut Context<Self>| cx.new(|cx| InputState::new(window, cx).default_value(v));
        let timeout = input(s.timeout_ms.to_string(), window, cx);
        let max_redirects = input(s.max_redirects.to_string(), window, cx);
        let script_timeout = input(s.script_timeout_s.to_string(), window, cx);
        let highlight = input(s.highlight_limit_kb.to_string(), window, cx);
        let proxy_url = cx.new(|cx| InputState::new(window, cx).placeholder("http://usuario:contraseña@proxy:8080").default_value(s.proxy_url.clone()));
        let proxy_bypass = input(s.proxy_bypass.clone(), window, cx);
        let cert_host = cx.new(|cx| InputState::new(window, cx).placeholder("api.example.com"));
        let servers = Some(cx.new(|cx| crate::ui::servers::ServersPanel::new(app.clone(), window, cx)));
        let mut subs = vec![];
        for i in [&timeout, &max_redirects, &script_timeout, &highlight, &proxy_url, &proxy_bypass] {
            subs.push(cx.subscribe_in(i, window, |this, _, ev: &InputEvent, _, cx| {
                if matches!(ev, InputEvent::Blur | InputEvent::PressEnter { .. }) {
                    this.commit_inputs(cx);
                }
            }));
        }
        Self { app, section: Section::General, draft: s, timeout, max_redirects, script_timeout, highlight, proxy_url, proxy_bypass, cert_host, pending_cert: (None, None), servers, focus: cx.focus_handle(), _subs: subs }
    }

    fn commit_inputs(&mut self, cx: &mut Context<Self>) {
        let num = |i: &Entity<InputState>, cx: &App| i.read(cx).value().trim().parse::<u64>().ok();
        if let Some(v) = num(&self.timeout, cx) {
            self.draft.timeout_ms = v.max(100);
        }
        if let Some(v) = num(&self.max_redirects, cx) {
            self.draft.max_redirects = v.min(100) as u32;
        }
        if let Some(v) = num(&self.script_timeout, cx) {
            self.draft.script_timeout_s = v.clamp(1, 600);
        }
        if let Some(v) = num(&self.highlight, cx) {
            self.draft.highlight_limit_kb = v.max(64);
        }
        self.draft.proxy_url = self.proxy_url.read(cx).value().trim().to_string();
        self.draft.proxy_bypass = self.proxy_bypass.read(cx).value().to_string();
        self.apply(cx);
    }

    fn apply(&mut self, cx: &mut Context<Self>) {
        let s = self.draft.clone();
        self.app.update(cx, |a, cx| a.save_settings(s, cx));
        cx.notify();
    }

    fn set(&mut self, f: impl FnOnce(&mut Settings), cx: &mut Context<Self>) {
        f(&mut self.draft);
        self.apply(cx);
    }

    fn pick(&mut self, which: u8, window: &mut Window, cx: &mut Context<Self>) {
        let rx = cx.prompt_for_paths(PathPromptOptions { files: true, directories: false, multiple: false, prompt: Some(tr("Elegir fichero")) });
        cx.spawn_in(window, async move |this, cx| {
            if let Ok(Ok(Some(paths))) = rx.await
                && let Some(p) = paths.first()
            {
                let path = p.to_string_lossy().to_string();
                let _ = this.update(cx, |this, cx| {
                    match which {
                        0 => this.pending_cert.0 = Some(path),
                        1 => this.pending_cert.1 = Some(path),
                        _ => this.set(|s| s.ca_path = path, cx),
                    }
                    cx.notify();
                });
            }
        })
        .detach();
    }

    fn add_cert(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let host = self.cert_host.read(cx).value().trim().to_string();
        let (Some(cert), Some(key)) = self.pending_cert.clone() else {
            window.push_notification(Notification::warning(tr("Elige el certificado y la clave (PEM)")), cx);
            return;
        };
        if host.is_empty() {
            window.push_notification(Notification::warning(tr("Escribe el dominio al que se presenta el certificado")), cx);
            return;
        }
        self.set(|s| s.client_certs.push(CertEntry { host, cert_path: cert, key_path: key }), cx);
        self.pending_cert = (None, None);
        self.cert_host.update(cx, |s, cx| s.set_value("", window, cx));
    }

    fn row(&self, label: SharedString, help: Option<SharedString>, control: impl IntoElement, cx: &App) -> Div {
        div()
            .h_flex()
            .items_start()
            .gap_6()
            .py_3()
            .border_b_1()
            .border_color(cx.theme().border)
            .child(div().v_flex().w(px(320.)).flex_none().gap_0p5().child(div().text_sm().font_medium().child(label)).when_some(help, |d, h| d.child(div().text_xs().text_color(cx.theme().muted_foreground).child(h))))
            .child(div().flex_1().child(control))
    }

    fn render_general(&mut self, cx: &mut Context<Self>) -> Div {
        let entity = cx.entity();
        let themes = vec![(tr("Como el sistema"), ThemeChoice::System), (tr("Claro"), ThemeChoice::Light), (tr("Oscuro"), ThemeChoice::Dark)];
        let langs = vec![(tr("Como el sistema"), Language::System), ("Español".into(), Language::Es), ("English".into(), Language::En)];
        div()
            .v_flex()
            .child(self.row(tr("Tema"), None, choice("theme", &self.draft.theme, themes, {
                let entity = entity.clone();
                move |t, window, cx| {
                    crate::theme::apply(t, Some(window), cx);
                    entity.update(cx, |this, cx| this.set(|s| s.theme = t, cx));
                }
            }), cx))
            .child(self.row(tr("Idioma"), Some(tr("Se aplica al momento.")), choice("language", &self.draft.language, langs, {
                let entity = entity.clone();
                move |l, window, cx| {
                    entity.update(cx, |this, cx| this.set(|s| s.language = l, cx));
                    let english = entity.read(cx).draft.english();
                    crate::i18n::set_english(english);
                    window.refresh();
                }
            }), cx))
    }

    fn render_requests(&mut self, cx: &mut Context<Self>) -> Div {
        let s = self.draft.clone();
        div()
            .v_flex()
            .child(self.row(tr("Tiempo máximo de espera (ms)"), Some(tr("Si el servidor no responde en este tiempo, la petición se cancela.")), div().w(px(160.)).child(Input::new(&self.timeout).small()), cx))
            .child(self.row(tr("Seguir redirecciones"), None, Switch::new("follow").checked(s.follow_redirects).on_click(cx.listener(|this, c: &bool, _, cx| this.set(|s| s.follow_redirects = *c, cx))), cx))
            .child(self.row(tr("Máximo de redirecciones"), None, div().w(px(160.)).child(Input::new(&self.max_redirects).small()), cx))
            .child(self.row(
                tr("Verificar los certificados SSL"),
                Some(tr("Desactívalo solo para servidores de desarrollo con certificados propios.")),
                Switch::new("verify").checked(s.verify_tls).on_click(cx.listener(|this, c: &bool, _, cx| this.set(|s| s.verify_tls = *c, cx))),
                cx,
            ))
            .child(self.row(tr("Tiempo máximo de un script (s)"), None, div().w(px(160.)).child(Input::new(&self.script_timeout).small()), cx))
            .child(self.row(
                tr("Guardar las variables que cambian los scripts"),
                Some(tr("pm.environment.set y pm.globals.set guardan el valor en el entorno o en las globales.")),
                Switch::new("persist").checked(s.persist_script_variables).on_click(cx.listener(|this, c: &bool, _, cx| this.set(|s| s.persist_script_variables = *c, cx))),
                cx,
            ))
            .child(self.row(tr("Resaltado hasta (KB)"), Some(tr("Las respuestas más grandes se muestran sin colores para que la app siga fluida.")), div().w(px(160.)).child(Input::new(&self.highlight).small()), cx))
    }

    fn render_proxy(&mut self, cx: &mut Context<Self>) -> Div {
        let s = self.draft.clone();
        div()
            .v_flex()
            .child(self.row(tr("Usar un proxy"), None, Switch::new("proxy").checked(s.proxy_enabled).on_click(cx.listener(|this, c: &bool, _, cx| this.set(|s| s.proxy_enabled = *c, cx))), cx))
            .child(self.row(tr("URL del proxy"), Some(tr("HTTP. Para HTTPS se abre un túnel CONNECT. Admite usuario y contraseña en la URL.")), Input::new(&self.proxy_url).small(), cx))
            .child(self.row(tr("Sin proxy para"), Some(tr("Dominios separados por comas.")), Input::new(&self.proxy_bypass).small(), cx))
    }

    fn render_certificates(&mut self, cx: &mut Context<Self>) -> Div {
        let s = self.draft.clone();
        let muted = cx.theme().muted_foreground;
        let file = |p: &Option<String>| p.as_ref().and_then(|p| std::path::Path::new(p).file_name().map(|n| n.to_string_lossy().to_string())).unwrap_or_else(|| tr("ninguno").to_string());
        div()
            .v_flex()
            .child(self.row(
                tr("Certificados de cliente"),
                Some(tr("Para APIs con TLS mutuo: el certificado se presenta solo a su dominio. Formato PEM.")),
                div()
                    .v_flex()
                    .gap_2()
                    .children(s.client_certs.iter().enumerate().map(|(i, c)| {
                        div()
                            .h_flex()
                            .gap_2()
                            .text_sm()
                            .child(div().w(px(200.)).font_semibold().child(c.host.clone()))
                            .child(div().flex_1().truncate().text_color(muted).child(c.cert_path.clone()))
                            .child(Button::new(("del-cert", i)).ghost().xsmall().icon(IconName::Trash).on_click(cx.listener(move |this, _, _, cx| this.set(|s| {
                                s.client_certs.remove(i);
                            }, cx))))
                    }))
                    .child(
                        div()
                            .h_flex()
                            .gap_2()
                            .child(div().w(px(200.)).child(Input::new(&self.cert_host).small()))
                            .child(Button::new("pick-cert").outline().small().label(trf("Certificado: {f}", &[("f", &file(&self.pending_cert.0))])).on_click(cx.listener(|this, _, w, cx| this.pick(0, w, cx))))
                            .child(Button::new("pick-key").outline().small().label(trf("Clave: {f}", &[("f", &file(&self.pending_cert.1))])).on_click(cx.listener(|this, _, w, cx| this.pick(1, w, cx))))
                            .child(Button::new("add-cert").primary().small().icon(IconName::Plus).label(tr("Añadir")).on_click(cx.listener(|this, _, w, cx| this.add_cert(w, cx)))),
                    ),
                cx,
            ))
            .child(self.row(
                tr("Certificados de CA propios"),
                Some(tr("Añade la CA de tu empresa para que sus certificados se acepten sin desactivar la verificación.")),
                div()
                    .h_flex()
                    .gap_2()
                    .child(Button::new("pick-ca").outline().small().icon(IconName::Upload).label(if s.ca_path.is_empty() { tr("Elegir fichero PEM…") } else { SharedString::from(s.ca_path.clone()) }).on_click(cx.listener(|this, _, w, cx| this.pick(2, w, cx))))
                    .when(!s.ca_path.is_empty(), |d| d.child(Button::new("clear-ca").ghost().xsmall().icon(IconName::X).on_click(cx.listener(|this, _, _, cx| this.set(|s| s.ca_path.clear(), cx))))),
                cx,
            ))
    }

    fn render_about(&mut self, cx: &mut Context<Self>) -> Div {
        let dir = self.app.read(cx).data_dir.to_string_lossy().to_string();
        let muted = cx.theme().muted_foreground;
        div()
            .v_flex()
            .gap_3()
            .child(div().h_flex().gap_3().child(img("cartero/logo.svg").size_12()).child(div().v_flex().child(div().text_xl().font_semibold().child("Cartero")).child(div().text_sm().text_color(muted).child(trf("Versión {v} · cliente de escritorio nativo", &[("v", env!("CARGO_PKG_VERSION"))])))))
            .child(div().text_sm().text_color(muted).child(tr("Tus colecciones, entornos e historial se guardan en este ordenador. Las variables secretas van cifradas con una clave guardada en el llavero del sistema.")))
            .child(self.row(tr("Carpeta de datos"), None, div().h_flex().gap_2().child(div().text_sm().child(dir.clone())).child(Button::new("open-dir").ghost().xsmall().icon(IconName::ExternalLink).on_click(move |_, _, _| {
                let _ = open::that(&dir);
            })), cx))
            .child(self.row(tr("Buscar actualizaciones al arrancar"), None, Switch::new("updates").checked(self.draft.check_updates).on_click(cx.listener(|this, c: &bool, _, cx| this.set(|s| s.check_updates = *c, cx))), cx))
            .child(div().h_flex().gap_2().child(Button::new("check-now").outline().small().icon(IconName::RefreshCw).label(tr("Buscar actualizaciones ahora")).on_click(cx.listener(|this, _, window, cx| crate::update::check_now(this.app.clone(), true, window, cx)))).child(Button::new("manual").ghost().small().icon(IconName::ExternalLink).label(tr("Manual de uso")).on_click(|_, _, _| {
                let _ = open::that(if crate::i18n::is_english() { "https://github.com/elrincondeisma/cartero/blob/main/docs/manual/18-desktop-app.md" } else { "https://github.com/elrincondeisma/cartero/blob/main/docs/manual/es/18-app-de-escritorio.md" });
            })))
    }
}

impl Focusable for SettingsTab {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl Render for SettingsTab {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sections = [
            (Section::General, tr("General"), IconName::Settings),
            (Section::Requests, tr("Peticiones"), IconName::Send),
            (Section::Proxy, tr("Proxy"), IconName::Globe),
            (Section::Certificates, tr("Certificados"), IconName::Lock),
            (Section::Servers, tr("Servidores"), IconName::Server),
            (Section::About, tr("Acerca de"), IconName::Info),
        ];
        let nav = div().v_flex().w(px(210.)).h_full().flex_none().gap_0p5().p_3().border_r_1().border_color(cx.theme().border).children(sections.iter().map(|(s, label, icon)| {
            let s = *s;
            let selected = self.section == s;
            div()
                .id(SharedString::from(format!("settings-{label}")))
                .h_flex()
                .gap_2()
                .px_2()
                .py_1p5()
                .rounded(px(6.))
                .text_sm()
                .cursor_pointer()
                .when(selected, |d| d.bg(cx.theme().accent).font_medium())
                .hover(|d| d.bg(cx.theme().accent))
                .child(Icon::new(*icon).size_4())
                .child(label.clone())
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.commit_inputs(cx);
                    this.section = s;
                    cx.notify();
                }))
        }));
        let content = match self.section {
            Section::General => self.render_general(cx),
            Section::Requests => self.render_requests(cx),
            Section::Proxy => self.render_proxy(cx),
            Section::Certificates => self.render_certificates(cx),
            Section::Servers => div().children(self.servers.clone()),
            Section::About => self.render_about(cx),
        };
        div().track_focus(&self.focus).size_full().flex().flex_row().child(nav).child(div().id("settings-content").flex_1().min_w_0().h_full().overflow_y_scroll().p_6().child(div().max_w(px(900.)).child(content)))
    }
}
