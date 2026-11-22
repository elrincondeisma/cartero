//! Diálogos: guardar en una colección, renombrar, confirmar, importar, ver como código y cookies.

use std::rc::Rc;

use cartero_model::Item;
use cartero_model::codegen::{Language, generate};
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::dialog::DialogFooter;
use gpui_kit::component::input::{Editor, EditorState, Input, InputState};
use gpui_kit::component::notification::Notification;

use crate::state::AppState;
use crate::ui::prelude::*;
use crate::ui::request::RequestTab;
use crate::ui::widgets::choice;

fn footer(ok_label: SharedString, danger: bool, on_ok: impl Fn(&mut Window, &mut App) + 'static) -> DialogFooter {
    let ok = Button::new("dialog-ok").label(ok_label).on_click(move |_, window, cx| on_ok(window, cx));
    let ok = if danger { ok.danger() } else { ok.primary() };
    DialogFooter::new()
        .child(Button::new("dialog-cancel").outline().label(tr("Cancelar")).on_click(|_, window, cx| window.close_dialog(cx)))
        .child(ok)
}

/// Pide un texto (renombrar, nueva colección…).
pub fn prompt_text(
    title: SharedString,
    label: SharedString,
    initial: String,
    ok_label: SharedString,
    window: &mut Window,
    cx: &mut App,
    on_ok: impl Fn(String, &mut Window, &mut App) + 'static,
) {
    let input = cx.new(|cx| InputState::new(window, cx).default_value(initial));
    input.update(cx, |s, cx| {
        s.focus(window, cx);
        s.select_all(window, cx)
    });
    let on_ok = Rc::new(on_ok);
    window.open_dialog(cx, move |dialog, _, cx| {
        let submit = {
            let input = input.clone();
            let on_ok = on_ok.clone();
            move |window: &mut Window, cx: &mut App| {
                let value = input.read(cx).value().trim().to_string();
                if !value.is_empty() {
                    window.close_dialog(cx);
                    on_ok(value, window, cx);
                }
            }
        };
        dialog
            .title(title.clone())
            .w(px(440.))
            .child(
                div()
                    .v_flex()
                    .gap_2()
                    .child(div().text_sm().text_color(cx.theme().muted_foreground).child(label.clone()))
                    .child(Input::new(&input)),
            )
            .footer(footer(ok_label.clone(), false, submit))
    });
}

/// Pide confirmación para algo que no se puede deshacer.
pub fn confirm(
    title: SharedString,
    body: SharedString,
    ok_label: SharedString,
    window: &mut Window,
    cx: &mut App,
    on_ok: impl Fn(&mut Window, &mut App) + 'static,
) {
    let on_ok = Rc::new(on_ok);
    window.open_dialog(cx, move |dialog, _, cx| {
        let on_ok = on_ok.clone();
        dialog.title(title.clone()).w(px(440.)).child(div().text_sm().text_color(cx.theme().muted_foreground).child(body.clone())).footer(
            footer(ok_label.clone(), true, move |window, cx| {
                window.close_dialog(cx);
                on_ok(window, cx)
            }),
        )
    });
}

/// Guardar una petición nueva: elegir colección (y carpeta) y nombre.
pub fn save_request_as(tab: Entity<RequestTab>, window: &mut Window, cx: &mut App) {
    let app = tab.read(cx).app.clone();
    let name = tab.read(cx).name.clone();
    let initial = if name.trim().is_empty() { tr("Petición nueva").to_string() } else { name };
    let input = cx.new(|cx| InputState::new(window, cx).default_value(initial));
    input.update(cx, |s, cx| s.focus(window, cx));
    // destino: (colección, carpeta)
    let targets: Vec<(SharedString, (String, Option<String>))> = {
        let state = app.read(cx);
        let mut out = vec![];
        for meta in &state.collections {
            out.push((meta.name.clone().into(), (meta.id.clone(), None)));
            if let Some(tree) = state.trees.get(&meta.id) {
                let mut flat = vec![];
                cartero_model::tree::walk(&tree.item, &mut flat, 1);
                for (it, depth) in flat.into_iter().filter(|(i, _)| i.is_folder()) {
                    out.push((
                        format!("{}{} / {}", "  ".repeat(depth), meta.name, it.name).into(),
                        (meta.id.clone(), Some(it.id().to_string())),
                    ));
                }
            }
        }
        out
    };
    if targets.is_empty() {
        // Sin colecciones: se crea una
        let id = app.read(cx).store.create_collection(&app.read(cx).workspace.id, tr("Mi colección").as_ref()).ok();
        app.update(cx, |a, cx| a.reload_collections(cx));
        if id.is_some() {
            save_request_as(tab, window, cx);
        }
        return;
    }
    let selected = Rc::new(std::cell::RefCell::new(targets[0].1.clone()));
    window.open_dialog(cx, move |dialog, _, cx| {
        let current = selected.borrow().clone();
        let picker = choice("save-target", &current, targets.clone(), {
            let selected = selected.clone();
            move |v, window, cx| {
                *selected.borrow_mut() = v;
                window.refresh();
                let _ = cx;
            }
        });
        let submit = {
            let input = input.clone();
            let tab = tab.clone();
            let selected = selected.clone();
            move |window: &mut Window, cx: &mut App| {
                let name = input.read(cx).value().trim().to_string();
                if name.is_empty() {
                    return;
                }
                let (collection, folder) = selected.borrow().clone();
                window.close_dialog(cx);
                tab.update(cx, |t, cx| t.save_into(&collection, folder.as_deref(), name, window, cx));
            }
        };
        let muted = cx.theme().muted_foreground;
        dialog
            .title(tr("Guardar petición"))
            .w(px(480.))
            .child(
                div()
                    .v_flex()
                    .gap_3()
                    .child(div().v_flex().gap_1().child(div().text_sm().text_color(muted).child(tr("Nombre"))).child(Input::new(&input)))
                    .child(div().v_flex().gap_1().child(div().text_sm().text_color(muted).child(tr("Guardar en"))).child(picker)),
            )
            .footer(footer(tr("Guardar"), false, submit))
    });
}

/// Ver la petición como código en varios lenguajes.
pub fn codegen(app: Entity<AppState>, collection_id: Option<String>, item: Item, window: &mut Window, cx: &mut App) {
    let prepared = {
        let state = app.read(cx);
        let ctx = state.run_context(collection_id.as_deref(), &item);
        let mut c = ctx.collection.clone();
        if let Some(slot) = cartero_model::tree::find_mut(&mut c.item, item.id()) {
            *slot = item.clone();
        }
        let auth = cartero_model::tree::effective_auth(&c, item.id()).map(|(a, _)| a.clone());
        cartero_model::prepare::prepare(item.request.as_ref().unwrap_or(&Default::default()), &ctx.vars.layers(), auth.as_ref())
    };
    let lang = Rc::new(std::cell::Cell::new(Language::Curl));
    let editor = cx.new(|cx| {
        let mut s = EditorState::new(window, cx)
            .language("bash".to_string())
            .line_number(true)
            .soft_wrap(true)
            .default_value(generate(Language::Curl, &prepared));
        s.set_readonly(true, cx);
        s
    });
    window.open_dialog(cx, move |dialog, _, cx| {
        let current = lang.get();
        let options: Vec<(SharedString, Language)> = Language::ALL.iter().map(|l| (SharedString::from(l.label()), *l)).collect();
        let picker = choice("codegen-lang", &current, options, {
            let lang = lang.clone();
            let editor = editor.clone();
            let prepared = prepared.clone();
            move |l: Language, window, cx| {
                lang.set(l);
                let code = generate(l, &prepared);
                editor.update(cx, |s, cx| {
                    s.set_highlighter(l.syntax(), cx);
                    s.set_value(code, window, cx);
                });
            }
        });
        let copy = {
            let editor = editor.clone();
            move |_: &ClickEvent, window: &mut Window, cx: &mut App| {
                cx.write_to_clipboard(ClipboardItem::new_string(editor.read(cx).value().to_string()));
                window.push_notification(Notification::success(tr("Código copiado")), cx);
            }
        };
        dialog
            .title(tr("Ver como código"))
            .w(px(760.))
            .child(
                div()
                    .v_flex()
                    .gap_2()
                    .child(
                        div()
                            .h_flex()
                            .gap_2()
                            .child(picker)
                            .child(div().flex_1())
                            .child(Button::new("copy-code").outline().small().icon(IconName::Copy).label(tr("Copiar")).on_click(copy)),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(cx.theme().muted_foreground)
                            .child(tr("Con las variables del entorno activo ya sustituidas. Ojo: incluye los secretos.")),
                    )
                    .child(div().h(px(380.)).child(Editor::new(&editor).h_full())),
            )
            .footer(
                DialogFooter::new()
                    .child(Button::new("close-code").outline().label(tr("Cerrar")).on_click(|_, window, cx| window.close_dialog(cx))),
            )
    });
}

/// Importar: pegar texto (Postman, entorno, cURL…) o elegir un fichero.
pub fn import(app: Entity<AppState>, window: &mut Window, cx: &mut App) {
    let editor = cx.new(|cx| EditorState::new(window, cx).language("json".to_string()).line_number(false).soft_wrap(true).placeholder(tr("Pega aquí una colección de Postman (v1, v2.0 o v2.1), un entorno, unas globales, una exportación de Cartero o un comando cURL")).default_value(""));
    window.open_dialog(cx, move |dialog, _, cx| {
        let pick = {
            let editor = editor.clone();
            move |_: &ClickEvent, window: &mut Window, cx: &mut App| {
                let rx = cx.prompt_for_paths(PathPromptOptions {
                    files: true,
                    directories: false,
                    multiple: false,
                    prompt: Some(tr("Importar")),
                });
                let editor = editor.clone();
                window
                    .spawn(cx, async move |cx| {
                        if let Ok(Ok(Some(paths))) = rx.await
                            && let Some(p) = paths.first()
                        {
                            match std::fs::read_to_string(p) {
                                Ok(text) => {
                                    let _ = cx.update(|window, cx| editor.update(cx, |s, cx| s.set_value(text, window, cx)));
                                }
                                Err(e) => {
                                    let _ = cx.update(|window, cx| window.push_notification(Notification::error(e.to_string()), cx));
                                }
                            }
                        }
                    })
                    .detach();
            }
        };
        let submit = {
            let editor = editor.clone();
            let app = app.clone();
            move |window: &mut Window, cx: &mut App| {
                let text = editor.read(cx).value().to_string();
                if text.trim().is_empty() {
                    return;
                }
                match import_text(&app, &text, cx) {
                    Ok(msg) => {
                        window.close_dialog(cx);
                        window.push_notification(Notification::success(msg).title(tr("Importado")), cx);
                    }
                    Err(e) => window.push_notification(Notification::error(e).title(tr("No se pudo importar")), cx),
                }
            }
        };
        dialog
            .title(tr("Importar"))
            .w(px(720.))
            .child(
                div()
                    .v_flex()
                    .gap_2()
                    .child(
                        div()
                            .h_flex()
                            .gap_2()
                            .child(
                                Button::new("import-file")
                                    .outline()
                                    .small()
                                    .icon(IconName::Upload)
                                    .label(tr("Elegir un fichero…"))
                                    .on_click(pick),
                            )
                            .child(div().text_xs().text_color(cx.theme().muted_foreground).child(tr("o pega el contenido debajo"))),
                    )
                    .child(div().h(px(320.)).child(Editor::new(&editor).h_full())),
            )
            .footer(footer(tr("Importar"), false, submit))
    });
}

/// Importa al workspace activo. Devuelve un resumen.
pub fn import_text(app: &Entity<AppState>, text: &str, cx: &mut App) -> Result<String, String> {
    let result = cartero_model::import::import_any(text).map_err(|e| e.to_string())?;
    let state = app.read(cx);
    let ws = state.workspace.id.clone();
    let store = state.store.clone();
    for c in &result.collections {
        store.import_collection(&ws, c).map_err(|e| e.to_string())?;
    }
    for e in &result.environments {
        store.create_environment(&ws, e).map_err(|e| e.to_string())?;
    }
    if let Some(g) = &result.globals {
        let mut current = store.globals(&ws).unwrap_or_default();
        current.retain(|v| !g.iter().any(|n| n.key == v.key));
        current.extend(g.iter().cloned());
        store.save_globals(&ws, &current).map_err(|e| e.to_string())?;
    }
    app.update(cx, |a, cx| {
        a.reload_collections(cx);
        a.reload_environments(cx);
    });
    let mut parts = vec![];
    if !result.collections.is_empty() {
        parts.push(trf("{n} colecciones", &[("n", &result.collections.len().to_string())]).to_string());
    }
    if !result.environments.is_empty() {
        parts.push(trf("{n} entornos", &[("n", &result.environments.len().to_string())]).to_string());
    }
    if result.globals.is_some() {
        parts.push(tr("variables globales").to_string());
    }
    let mut msg = parts.join(", ");
    if !result.warnings.is_empty() {
        msg.push_str(&format!(" ({})", result.warnings.join("; ")));
    }
    Ok(msg)
}

/// Gestor de cookies del workspace.
pub fn cookies(app: Entity<AppState>, window: &mut Window, cx: &mut App) {
    let new_url = cx.new(|cx| InputState::new(window, cx).placeholder("https://api.example.com"));
    let new_cookie = cx.new(|cx| InputState::new(window, cx).placeholder("nombre=valor; Path=/"));
    window.open_dialog(cx, move |dialog, _, cx| {
        let jar = app.read(cx).jar.clone();
        let list = jar.try_lock().map(|j| j.list()).unwrap_or_default();
        let muted = cx.theme().muted_foreground;
        let border = cx.theme().border;
        let rows = list.into_iter().enumerate().map(|(i, c)| {
            let jar = jar.clone();
            let app = app.clone();
            div()
                .h_flex()
                .gap_2()
                .py_1()
                .border_b_1()
                .border_color(border)
                .text_sm()
                .child(div().w(px(170.)).flex_none().text_color(muted).child(c.domain.clone()))
                .child(div().w(px(140.)).flex_none().font_semibold().child(c.name.clone()))
                .child(div().flex_1().min_w_0().child(c.value.chars().take(80).collect::<String>()))
                .child(Button::new(("del-cookie", i)).ghost().xsmall().icon(IconName::Trash).tooltip(tr("Borrar")).on_click(move |_, window, cx| {
                    if let Ok(mut j) = jar.try_lock() {
                        j.remove(&c.domain, &c.path, &c.name);
                    }
                    app.read(cx).save_cookies();
                    window.refresh();
                }))
        });
        let add = {
            let jar = jar.clone();
            let app = app.clone();
            let new_url = new_url.clone();
            let new_cookie = new_cookie.clone();
            move |_: &ClickEvent, window: &mut Window, cx: &mut App| {
                let url = new_url.read(cx).value().to_string();
                let cookie = new_cookie.read(cx).value().to_string();
                let ok = url::Url::parse(&url).ok().is_some_and(|u| jar.try_lock().map(|mut j| j.set(&u, &cookie)).unwrap_or(false));
                if ok {
                    app.read(cx).save_cookies();
                    new_cookie.update(cx, |s, cx| s.set_value("", window, cx));
                    window.refresh();
                } else {
                    window.push_notification(Notification::error(tr("Revisa la URL y la cookie (nombre=valor)")), cx);
                }
            }
        };
        let clear = {
            let jar = jar.clone();
            let app = app.clone();
            move |_: &ClickEvent, window: &mut Window, cx: &mut App| {
                if let Ok(mut j) = jar.try_lock() {
                    j.clear();
                }
                app.read(cx).save_cookies();
                window.refresh();
            }
        };
        dialog
            .title(tr("Cookies"))
            .w(px(760.))
            .child(
                div()
                    .v_flex()
                    .gap_3()
                    .child(div().text_sm().text_color(muted).child(tr("Las cookies que envían los servidores se guardan aquí y se mandan solas en las siguientes peticiones del workspace.")))
                    .child(div().id("cookie-list").max_h(px(320.)).overflow_y_scroll().v_flex().children(rows))
                    .child(div().h_flex().gap_2().child(div().w(px(240.)).child(Input::new(&new_url).small())).child(div().flex_1().child(Input::new(&new_cookie).small())).child(Button::new("add-cookie").outline().small().icon(IconName::Plus).label(tr("Añadir")).on_click(add))),
            )
            .footer(
                DialogFooter::new()
                    .child(Button::new("clear-cookies").ghost().label(tr("Borrar todas")).on_click(clear))
                    .child(Button::new("close-cookies").outline().label(tr("Cerrar")).on_click(|_, window, cx| window.close_dialog(cx))),
            )
    });
}
