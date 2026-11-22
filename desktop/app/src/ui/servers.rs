//! Ajustes → Servidores: conectar un servidor de Cartero, ver sus workspaces y vincularlos.

use cartero_sync::RemoteWorkspace;
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::input::{Input, InputState};
use gpui_kit::component::notification::Notification;

use crate::state::{AppState, ServerInfo, StateEvent};
use crate::ui::dialogs;
use crate::ui::prelude::*;

pub struct ServersPanel {
    app: Entity<AppState>,
    url: Entity<InputState>,
    token: Entity<InputState>,
    show_token: bool,
    connecting: bool,
    remote: std::collections::HashMap<String, Result<Vec<RemoteWorkspace>, String>>,
    busy: Option<String>,
    _subs: Vec<Subscription>,
}

impl ServersPanel {
    pub fn new(app: Entity<AppState>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let url = cx.new(|cx| InputState::new(window, cx).placeholder("https://cartero.miempresa.com"));
        let token = cx.new(|cx| InputState::new(window, cx).placeholder("crt_…").masked(true));
        let sub = cx.subscribe(&app, |this, _, ev: &StateEvent, cx| {
            if matches!(ev, StateEvent::Sync) {
                this.load_remote(cx);
            }
            cx.notify();
        });
        let mut this =
            Self { app, url, token, show_token: false, connecting: false, remote: Default::default(), busy: None, _subs: vec![sub] };
        this.load_remote(cx);
        this
    }

    fn server_url(&self, cx: &App) -> Option<String> {
        let raw = self.url.read(cx).value().trim().trim_end_matches('/').to_string();
        if raw.is_empty() {
            return None;
        }
        Some(if raw.contains("://") { raw } else { format!("https://{raw}") })
    }

    fn load_remote(&mut self, cx: &mut Context<Self>) {
        let servers = self.app.read(cx).servers.clone();
        for s in servers {
            let Some(client) = self.app.read(cx).client_for(&s) else { continue };
            let id = s.id.clone();
            let task = crate::runtime::spawn(async move { client.workspaces().await.map_err(|e| e.to_string()) });
            cx.spawn(async move |this, cx| {
                let r = task.await.unwrap_or_else(|e| Err(e.to_string()));
                let _ = this.update(cx, |this, cx| {
                    this.remote.insert(id, r);
                    cx.notify();
                });
            })
            .detach();
        }
    }

    /// Comprueba el token con /api/auth/me y guarda el servidor.
    fn finish_connect(&mut self, url: String, token: String, window: &mut Window, cx: &mut Context<Self>) {
        let client = cartero_sync::Client::new(&url, &token, self.app.read(cx).settings.http_options());
        let task = crate::runtime::spawn(async move { client.me().await });
        cx.spawn_in(window, async move |this, cx| {
            let r = task.await.unwrap_or_else(|e| Err(cartero_sync::SyncError::Network(e.to_string())));
            let _ = this.update_in(cx, |this, window, cx| {
                this.connecting = false;
                match r {
                    Ok(me) => {
                        let info = ServerInfo {
                            id: uuid::Uuid::new_v4().to_string(),
                            url: url.clone(),
                            user_id: me.id,
                            email: me.email.clone(),
                            name: me.name,
                        };
                        // Si ya estaba conectado ese servidor con la misma cuenta, se reutiliza
                        let existing = this.app.read(cx).servers.iter().find(|s| s.url == url && s.email == me.email).map(|s| s.id.clone());
                        let info = ServerInfo { id: existing.unwrap_or(info.id.clone()), ..info };
                        this.app.update(cx, |a, cx| a.save_server(info, &token, cx));
                        this.token.update(cx, |s, cx| s.set_value("", window, cx));
                        this.show_token = false;
                        window.push_notification(
                            Notification::success(trf("Conectado como {email}", &[("email", &me.email)])).title(tr("Servidor conectado")),
                            cx,
                        );
                    }
                    Err(e) => window.push_notification(Notification::error(e.to_string()).title(tr("No se pudo conectar")), cx),
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn connect_browser(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(url) = self.server_url(cx) else {
            window.push_notification(Notification::warning(tr("Escribe la dirección del servidor")), cx);
            return;
        };
        self.connecting = true;
        cx.notify();
        let u = url.clone();
        let task = crate::runtime::spawn(crate::connect::via_browser(u, |link| {
            let _ = open::that(link);
        }));
        cx.spawn_in(window, async move |this, cx| {
            let r = task.await.unwrap_or_else(|e| Err(e.to_string()));
            let _ = this.update_in(cx, |this, window, cx| match r {
                Ok(token) => this.finish_connect(url, token, window, cx),
                Err(e) => {
                    this.connecting = false;
                    window.push_notification(Notification::error(e).title(tr("No se pudo conectar")), cx);
                    cx.notify();
                }
            });
        })
        .detach();
    }

    fn connect_token(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let (Some(url), token) = (self.server_url(cx), self.token.read(cx).value().trim().to_string()) else {
            window.push_notification(Notification::warning(tr("Escribe la dirección del servidor")), cx);
            return;
        };
        if token.is_empty() {
            return;
        }
        self.connecting = true;
        self.finish_connect(url, token, window, cx);
    }

    /// Baja un workspace del servidor a uno local nuevo.
    fn download(&mut self, server: ServerInfo, remote: RemoteWorkspace, window: &mut Window, cx: &mut Context<Self>) {
        let app = self.app.clone();
        let store = app.read(cx).store.clone();
        let existing = app.read(cx).workspaces.iter().find(|w| w.remote_id.as_deref() == Some(remote.id.as_str())).map(|w| w.id.clone());
        let id = match existing {
            Some(id) => id,
            None => match store.create_workspace(&remote.name) {
                Ok(w) => {
                    let _ = store.link_workspace(&w.id, Some(&server.id), Some(&remote.id));
                    w.id
                }
                Err(e) => {
                    window.push_notification(Notification::error(e.to_string()), cx);
                    return;
                }
            },
        };
        app.update(cx, |a, cx| {
            a.refresh_workspaces(cx);
            a.switch_workspace(&id, cx);
        });
        window.push_notification(Notification::info(trf("Descargando «{name}»…", &[("name", &remote.name)])), cx);
    }

    /// Sube el workspace activo a un workspace nuevo del servidor y los vincula.
    fn upload_current(&mut self, server: ServerInfo, window: &mut Window, cx: &mut Context<Self>) {
        let app = self.app.clone();
        let local = app.read(cx).workspace.clone();
        let Some(client) = app.read(cx).client_for(&server) else { return };
        self.busy = Some(server.id.clone());
        cx.notify();
        let name = local.name.clone();
        let task = crate::runtime::spawn(async move { client.create_workspace(&name).await });
        cx.spawn_in(window, async move |this, cx| {
            let r = task.await.unwrap_or_else(|e| Err(cartero_sync::SyncError::Network(e.to_string())));
            let _ = this.update_in(cx, |this, window, cx| {
                this.busy = None;
                match r {
                    Ok(remote) => {
                        let store = app.read(cx).store.clone();
                        let _ = store.link_workspace(&local.id, Some(&server.id), Some(&remote.id));
                        let _ = store.mark_all_dirty(&local.id);
                        app.update(cx, |a, cx| {
                            a.refresh_workspaces(cx);
                            cx.emit(StateEvent::Sync);
                        });
                        window.push_notification(
                            Notification::success(trf("«{name}» se está subiendo al servidor", &[("name", &local.name)])),
                            cx,
                        );
                    }
                    Err(e) => window.push_notification(Notification::error(e.to_string()), cx),
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn unlink_current(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let app = self.app.clone();
        dialogs::confirm(
            tr("Dejar de sincronizar"),
            tr("El workspace se queda en este ordenador con todo su contenido, pero deja de sincronizarse con el servidor."),
            tr("Dejar de sincronizar"),
            window,
            cx,
            move |_, cx| {
                let id = app.read(cx).workspace.id.clone();
                let _ = app.read(cx).store.link_workspace(&id, None, None);
                app.update(cx, |a, cx| {
                    a.refresh_workspaces(cx);
                    cx.emit(StateEvent::Sync);
                });
            },
        );
    }
}

impl Render for ServersPanel {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let muted = cx.theme().muted_foreground;
        let border = cx.theme().border;
        let app = self.app.read(cx);
        let servers = app.servers.clone();
        let current = app.workspace.clone();
        let current_server = current.server_id.clone();
        let add = div()
            .v_flex()
            .gap_2()
            .p_4()
            .rounded(px(8.))
            .border_1()
            .border_color(border)
            .child(div().text_sm().font_semibold().child(tr("Conectar un servidor de Cartero")))
            .child(div().text_xs().text_color(muted).child(tr("Con un servidor puedes sincronizar workspaces entre ordenadores y trabajar en equipo. Sin él, todo funciona igual en este ordenador.")))
            .child(Input::new(&self.url).small())
            .child(
                div()
                    .h_flex()
                    .gap_2()
                    .child(Button::new("connect-browser").primary().small().icon(IconName::LogIn).label(tr("Conectar con el navegador")).loading(self.connecting).on_click(cx.listener(|this, _, w, cx| this.connect_browser(w, cx))))
                    .child(Button::new("toggle-token").ghost().small().label(tr("Usar un token")).on_click(cx.listener(|this, _, _, cx| {
                        this.show_token = !this.show_token;
                        cx.notify();
                    }))),
            )
            .when(self.show_token, |d| {
                d.child(div().text_xs().text_color(muted).child(tr("Crea un token en la web de Cartero: Ajustes → Tokens de API.")))
                    .child(div().h_flex().gap_2().child(div().flex_1().child(Input::new(&self.token).small().mask_toggle())).child(Button::new("connect-token").outline().small().label(tr("Conectar")).on_click(cx.listener(|this, _, w, cx| this.connect_token(w, cx)))))
            });
        let list = servers.into_iter().enumerate().map(|(i, s)| {
            let remote = self.remote.get(&s.id).cloned();
            let linked_here = current_server.as_deref() == Some(s.id.as_str());
            let (s1, s2, s3) = (s.clone(), s.clone(), s.id.clone());
            let workspaces: AnyElement = match remote {
                None => div().text_xs().text_color(muted).child(tr("Cargando workspaces…")).into_any_element(),
                Some(Err(e)) => div().text_xs().text_color(cx.theme().danger).child(e).into_any_element(),
                Some(Ok(list)) => div()
                    .v_flex()
                    .gap_1()
                    .children(list.into_iter().enumerate().map(|(j, w)| {
                        let local = self
                            .app
                            .read(cx)
                            .workspaces
                            .iter()
                            .find(|l| l.remote_id.as_deref() == Some(w.id.as_str()))
                            .map(|l| l.name.clone());
                        let server = s1.clone();
                        let w2 = w.clone();
                        div()
                            .h_flex()
                            .gap_2()
                            .text_sm()
                            .child(Icon::new(IconName::Cloud).size_4())
                            .child(div().flex_1().child(w.name.clone()))
                            .when_some(w.role.clone(), |d, r| {
                                let role = match r.as_str() {
                                    "owner" => tr("propietario"),
                                    "editor" => tr("editor"),
                                    "viewer" => tr("lector"),
                                    _ => SharedString::from(r),
                                };
                                d.child(div().text_xs().text_color(muted).child(role))
                            })
                            .child(
                                Button::new(("ws-dl", i * 1000 + j))
                                    .ghost()
                                    .xsmall()
                                    .label(if local.is_some() { tr("Abrir") } else { tr("Descargar") })
                                    .on_click(cx.listener(move |this, _, w, cx| this.download(server.clone(), w2.clone(), w, cx))),
                            )
                    }))
                    .into_any_element(),
            };
            div()
                .v_flex()
                .gap_2()
                .p_4()
                .rounded(px(8.))
                .border_1()
                .border_color(border)
                .child(
                    div()
                        .h_flex()
                        .gap_2()
                        .child(Icon::new(IconName::Server).size_5())
                        .child(
                            div()
                                .v_flex()
                                .flex_1()
                                .child(div().text_sm().font_semibold().child(s.url.clone()))
                                .child(div().text_xs().text_color(muted).child(trf("Conectado como {email}", &[("email", &s.email)]))),
                        )
                        .child(
                            Button::new(("srv-del", i))
                                .ghost()
                                .xsmall()
                                .icon(IconName::Unlink)
                                .tooltip(tr("Desconectar este servidor"))
                                .on_click(cx.listener(move |this, _, window, cx| {
                                    let app = this.app.clone();
                                    let id = s3.clone();
                                    dialogs::confirm(
                                        tr("Desconectar el servidor"),
                                        tr("Los workspaces descargados se quedan en este ordenador, pero dejan de sincronizarse."),
                                        tr("Desconectar"),
                                        window,
                                        cx,
                                        move |_, cx| app.update(cx, |a, cx| a.remove_server(&id, cx)),
                                    );
                                })),
                        ),
                )
                .child(div().text_xs().font_semibold().text_color(muted).child(tr("Workspaces en el servidor")))
                .child(workspaces)
                .child(div().h_flex().gap_2().pt_1().child(if linked_here {
                    Button::new(("unlink", i))
                        .outline()
                        .small()
                        .icon(IconName::CloudOff)
                        .label(trf("Dejar de sincronizar «{name}»", &[("name", &current.name)]))
                        .on_click(cx.listener(|this, _, w, cx| this.unlink_current(w, cx)))
                } else {
                    Button::new(("upload", i))
                        .outline()
                        .small()
                        .icon(IconName::Upload)
                        .label(trf("Subir «{name}» a este servidor", &[("name", &current.name)]))
                        .disabled(current_server.is_some())
                        .loading(self.busy.as_deref() == Some(s.id.as_str()))
                        .on_click(cx.listener(move |this, _, w, cx| this.upload_current(s2.clone(), w, cx)))
                }))
        });
        div().v_flex().gap_4().children(list).child(add)
    }
}
