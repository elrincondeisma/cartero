//! Motor de sincronización del workspace activo: cada 15 s, al cambiar de workspace, al
//! pulsar «Sincronizar ahora» y al momento cuando el servidor avisa por WebSocket.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use cartero_sync::realtime::{self, Event};

use crate::state::{AppState, StateEvent, SyncStatus};
use crate::ui::prelude::*;

pub struct SyncEngine {
    app: Entity<AppState>,
    running: bool,
    again: bool,
    realtime: Option<(String, Arc<AtomicBool>)>,
    _subs: Vec<Subscription>,
    _timer: Task<()>,
}

impl SyncEngine {
    pub fn new(app: Entity<AppState>, cx: &mut Context<Self>) -> Self {
        let mut subs = vec![];
        subs.push(cx.subscribe(&app, |this, _, ev: &StateEvent, cx| {
            if matches!(ev, StateEvent::Workspace | StateEvent::Sync) {
                this.restart_realtime(cx);
                this.sync_now(cx);
            }
        }));
        let timer = cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(Duration::from_secs(15)).await;
                if this.update(cx, |this, cx| this.sync_now(cx)).is_err() {
                    return;
                }
            }
        });
        let mut this = Self { app, running: false, again: false, realtime: None, _subs: subs, _timer: timer };
        this.restart_realtime(cx);
        this.sync_now(cx);
        this
    }

    pub fn sync_now(&mut self, cx: &mut Context<Self>) {
        if self.running {
            self.again = true;
            return;
        }
        let Some((client, remote, _)) = self.app.read(cx).sync_client() else {
            let linked = self.app.read(cx).workspace.server_id.is_some();
            self.app.update(cx, |a, cx| {
                a.sync_status = if linked {
                    SyncStatus::Error(tr("Vuelve a conectar el servidor en Ajustes → Servidores").to_string())
                } else {
                    SyncStatus::Local
                };
                a.presence.clear();
                cx.notify();
            });
            return;
        };
        self.running = true;
        let store = self.app.read(cx).store.clone();
        let ws = self.app.read(cx).workspace.id.clone();
        self.app.update(cx, |a, cx| {
            if !matches!(a.sync_status, SyncStatus::Synced(_)) {
                a.sync_status = SyncStatus::Syncing;
            }
            cx.notify();
        });
        let ws_task = ws.clone();
        let task = crate::runtime::spawn(async move { client.sync(&store, &ws_task, &remote).await });
        cx.spawn(async move |this, cx| {
            let result = task.await.unwrap_or_else(|e| Err(cartero_sync::SyncError::Network(e.to_string())));
            let _ = this.update(cx, |this, cx| {
                this.running = false;
                let app = this.app.clone();
                app.update(cx, |a, cx| {
                    // Si mientras tanto se cambió de workspace, el resultado ya no aplica
                    if a.workspace.id != ws {
                        return;
                    }
                    match &result {
                        Ok(r) => {
                            a.sync_status = if r.errors.is_empty() {
                                SyncStatus::Synced(chrono::Local::now().format("%H:%M").to_string())
                            } else {
                                SyncStatus::Error(r.errors.join("; "))
                            };
                            if r.pulled > 0 {
                                a.reload_collections(cx);
                                a.reload_environments(cx);
                                cx.emit(StateEvent::RemoteChanged);
                            }
                        }
                        Err(cartero_sync::SyncError::Network(e)) => a.sync_status = SyncStatus::Offline(e.clone()),
                        Err(e) => a.sync_status = SyncStatus::Error(e.to_string()),
                    }
                    a.conflicts = a.store.conflicts(&ws).map(|c| c.len()).unwrap_or(0);
                    cx.notify();
                });
                if std::mem::take(&mut this.again) {
                    this.sync_now(cx);
                }
            });
        })
        .detach();
    }

    fn restart_realtime(&mut self, cx: &mut Context<Self>) {
        let target = self.app.read(cx).sync_client().map(|(c, remote, server)| (c.base.clone(), remote, server));
        let key = target.as_ref().map(|(b, r, _)| format!("{b}|{r}"));
        if self.realtime.as_ref().map(|(k, _)| Some(k.clone())) == Some(key.clone()) {
            return;
        }
        if let Some((_, stop)) = self.realtime.take() {
            stop.store(true, Ordering::Relaxed);
        }
        let (Some(key), Some((base, remote, server))) = (key, target) else { return };
        let Some(token) = self.app.read(cx).server_token(&server.id) else { return };
        let stop = Arc::new(AtomicBool::new(false));
        self.realtime = Some((key, stop.clone()));
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        crate::runtime::spawn(realtime::listen(base, token, remote, server.user_id.clone(), tx, stop));
        cx.spawn(async move |this, cx| {
            while let Some(ev) = rx.recv().await {
                let ok = this
                    .update(cx, |this, cx| match ev {
                        Event::Changed => this.sync_now(cx),
                        Event::Presence(users) => this.app.update(cx, |a, cx| {
                            a.presence = users;
                            cx.notify();
                        }),
                        Event::Connected => this.sync_now(cx),
                        Event::Disconnected(_) => this.app.update(cx, |a, cx| {
                            a.presence.clear();
                            cx.notify();
                        }),
                    })
                    .is_ok();
                if !ok {
                    return;
                }
            }
        })
        .detach();
    }
}
