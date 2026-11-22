//! Indicador de sincronización de la barra de título: estado, conflictos y quién está conectado.

use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::dialog::DialogFooter;
use gpui_kit::component::menu::{DropdownMenu as _, PopupMenuItem};

use crate::state::{AppState, StateEvent, SyncStatus};
use crate::ui::prelude::*;

pub fn render(app: &Entity<AppState>, cx: &App) -> impl IntoElement + use<> {
    let state = app.read(cx);
    if state.workspace.server_id.is_none() {
        return div().into_any_element();
    }
    let me = state
        .workspace
        .server_id
        .as_ref()
        .and_then(|sid| state.servers.iter().find(|s| &s.id == sid))
        .map(|s| s.user_id.clone())
        .unwrap_or_default();
    let others: Vec<_> = state.presence.iter().filter(|p| p.id != me).cloned().collect();
    let (icon, label): (IconName, SharedString) = match &state.sync_status {
        SyncStatus::Local => (IconName::Cloud, tr("Sincronización")),
        SyncStatus::Syncing => (IconName::RefreshCw, tr("Sincronizando…")),
        SyncStatus::Synced(t) => (IconName::Cloud, trf("Sincronizado {t}", &[("t", t)])),
        SyncStatus::Offline(_) => (IconName::CloudOff, tr("Sin conexión")),
        SyncStatus::Error(_) => (IconName::TriangleAlert, tr("Error al sincronizar")),
    };
    let detail: Option<String> = match &state.sync_status {
        SyncStatus::Offline(e) | SyncStatus::Error(e) => Some(e.clone()),
        _ => None,
    };
    let conflicts = state.conflicts;
    let avatars = others.into_iter().take(5).map(|p| {
        let initial = p.name.chars().next().map(|c| c.to_uppercase().to_string()).unwrap_or_default();
        let color: Hsla = Rgba::try_from(p.color.as_str()).map(Into::into).unwrap_or(crate::theme::brand());
        div()
            .size_5()
            .rounded_full()
            .bg(color)
            .text_color(gpui_kit::white())
            .text_xs()
            .flex()
            .items_center()
            .justify_center()
            .child(initial)
    });
    let a1 = app.clone();
    let a2 = app.clone();
    div()
        .h_flex()
        .gap_1()
        .child(div().h_flex().gap_0p5().children(avatars))
        .child(
            Button::new("sync-status")
                .ghost()
                .small()
                .icon(if conflicts > 0 { IconName::TriangleAlert } else { icon })
                .label(if conflicts > 0 { trf("{n} conflictos", &[("n", &conflicts.to_string())]) } else { label })
                .when(conflicts > 0, |b| b.text_color(cx.theme().warning))
                .dropdown_menu(move |menu, _, _| {
                    let (x1, x2) = (a1.clone(), a2.clone());
                    let mut menu = menu.item(
                        PopupMenuItem::new(tr("Sincronizar ahora"))
                            .icon(IconName::RefreshCw)
                            .on_click(move |_, _, cx| x1.update(cx, |_, cx| cx.emit(StateEvent::Sync))),
                    );
                    if conflicts > 0 {
                        menu = menu.item(
                            PopupMenuItem::new(tr("Resolver conflictos…"))
                                .icon(IconName::TriangleAlert)
                                .on_click(move |_, w, cx| conflicts_dialog(x2.clone(), w, cx)),
                        );
                    }
                    if let Some(d) = detail.clone() {
                        menu = menu.separator().label(d.chars().take(120).collect::<String>());
                    }
                    menu
                }),
        )
        .into_any_element()
}

/// Lista de conflictos con las dos versiones y la decisión.
pub fn conflicts_dialog(app: Entity<AppState>, window: &mut Window, cx: &mut App) {
    window.open_dialog(cx, move |dialog, _, cx| {
        let state = app.read(cx);
        let ws = state.workspace.id.clone();
        let list = state.store.conflicts(&ws).unwrap_or_default();
        let muted = cx.theme().muted_foreground;
        let border = cx.theme().border;
        let mono = cx.theme().mono_font_family.clone();
        let show = |v: &serde_json::Value| -> String {
            let mut v = v.clone();
            if let Some(o) = v.as_object_mut() {
                o.remove("version");
            }
            serde_json::to_string_pretty(&v).unwrap_or_default().chars().take(1500).collect()
        };
        let rows = list.into_iter().enumerate().map(|(i, c)| {
            let (app1, app2) = (app.clone(), app.clone());
            let (c1, c2) = (c.clone(), c.clone());
            let ws1 = ws.clone();
            let ws2 = ws.clone();
            let kind = match c.entity {
                cartero_store::sync::Entity::Collection => tr("Colección"),
                cartero_store::sync::Entity::Item => tr("Petición o carpeta"),
                cartero_store::sync::Entity::Environment => tr("Entorno"),
                cartero_store::sync::Entity::Globals => tr("Variables globales"),
            };
            div()
                .v_flex()
                .gap_2()
                .py_3()
                .border_b_1()
                .border_color(border)
                .child(
                    div()
                        .h_flex()
                        .gap_2()
                        .child(div().text_sm().font_semibold().child(c.name.clone()))
                        .child(div().text_xs().text_color(muted).child(kind)),
                )
                .child(
                    div()
                        .flex()
                        .flex_row()
                        .gap_2()
                        .child(
                            div()
                                .flex_1()
                                .v_flex()
                                .gap_1()
                                .child(div().text_xs().text_color(muted).child(tr("La tuya (este ordenador)")))
                                .child(
                                    div()
                                        .id(("c-local", i))
                                        .max_h(px(180.))
                                        .overflow_y_scroll()
                                        .p_2()
                                        .rounded(px(6.))
                                        .bg(cx.theme().muted)
                                        .text_xs()
                                        .font_family(mono.clone())
                                        .child(show(&c.local)),
                                ),
                        )
                        .child(
                            div().flex_1().v_flex().gap_1().child(div().text_xs().text_color(muted).child(tr("La del servidor"))).child(
                                div()
                                    .id(("c-remote", i))
                                    .max_h(px(180.))
                                    .overflow_y_scroll()
                                    .p_2()
                                    .rounded(px(6.))
                                    .bg(cx.theme().muted)
                                    .text_xs()
                                    .font_family(mono.clone())
                                    .child(if c.remote.is_null() { tr("(borrada en el servidor)").to_string() } else { show(&c.remote) }),
                            ),
                        ),
                )
                .child(
                    div()
                        .h_flex()
                        .gap_2()
                        .child(Button::new(("keep-local", i)).primary().small().label(tr("Quedarme con la mía")).on_click(
                            move |_, window, cx| {
                                let _ = app1.read(cx).store.resolve_conflict(&ws1, &c1, true);
                                app1.update(cx, |a, cx| {
                                    a.conflicts = a.conflicts.saturating_sub(1);
                                    cx.emit(StateEvent::Sync);
                                });
                                window.refresh();
                            },
                        ))
                        .child(Button::new(("keep-remote", i)).outline().small().label(tr("Quedarme con la del servidor")).on_click(
                            move |_, window, cx| {
                                let _ = app2.read(cx).store.resolve_conflict(&ws2, &c2, false);
                                app2.update(cx, |a, cx| {
                                    a.conflicts = a.conflicts.saturating_sub(1);
                                    a.reload_collections(cx);
                                    a.reload_environments(cx);
                                    cx.emit(StateEvent::RemoteChanged);
                                });
                                window.refresh();
                            },
                        )),
                )
        });
        dialog
            .title(tr("Conflictos de sincronización"))
            .w(px(820.))
            .child(
                div()
                    .v_flex()
                    .child(
                        div()
                            .text_sm()
                            .text_color(muted)
                            .child(tr("Alguien cambió en el servidor lo mismo que tú aquí. Elige qué versión se queda.")),
                    )
                    .child(div().id("conflict-list").max_h(px(520.)).overflow_y_scroll().v_flex().children(rows)),
            )
            .footer(
                DialogFooter::new()
                    .child(Button::new("close-conflicts").outline().label(tr("Cerrar")).on_click(|_, window, cx| window.close_dialog(cx))),
            )
    });
}
