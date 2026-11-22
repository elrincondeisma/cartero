//! Paleta (Ctrl+K): buscar peticiones de todas las colecciones y ejecutar comandos.

use std::rc::Rc;

use gpui_kit::component::input::{Input, InputEvent, InputState};

use crate::state::AppState;
use crate::ui::prelude::*;
use crate::ui::sidebar::Panel;
use crate::ui::widgets::method_label;
use crate::ui::window::MainWindow;

#[derive(Clone)]
enum Entry {
    Request { collection: String, item: String, method: String, name: String, path: String },
    Command { label: SharedString, icon: IconName, run: Rc<dyn Fn(&mut MainWindow, &mut Window, &mut Context<MainWindow>)> },
}

fn commands() -> Vec<Entry> {
    let cmd = |label: SharedString, icon: IconName, f: fn(&mut MainWindow, &mut Window, &mut Context<MainWindow>)| Entry::Command { label, icon, run: Rc::new(f) };
    vec![
        cmd(tr("Petición nueva"), IconName::Plus, |w, win, cx| w.new_request(win, cx)),
        cmd(tr("Importar de Postman o cURL"), IconName::Import, |w, win, cx| w.open_import(win, cx)),
        cmd(tr("Ver los entornos"), IconName::Layers, |w, _, cx| w.show_panel(Panel::Environments, cx)),
        cmd(tr("Ver el historial"), IconName::Clock, |w, _, cx| w.show_panel(Panel::History, cx)),
        cmd(tr("Ajustes"), IconName::Settings, |w, win, cx| w.open_settings(None, win, cx)),
        cmd(tr("Conectar con un servidor de Cartero"), IconName::Cloud, |w, win, cx| w.open_settings(Some(crate::ui::settings::Section::Servers), win, cx)),
        cmd(tr("Cambiar entre tema claro y oscuro"), IconName::Moon, |w, win, cx| w.toggle_theme(win, cx)),
    ]
}

pub fn open(main: Entity<MainWindow>, app: Entity<AppState>, window: &mut Window, cx: &mut App) {
    let input = cx.new(|cx| InputState::new(window, cx).placeholder(tr("Busca una petición o un comando…")));
    input.update(cx, |s, cx| s.focus(window, cx));
    let mut all: Vec<Entry> = vec![];
    {
        let state = app.read(cx);
        for meta in &state.collections {
            if let Some(t) = state.trees.get(&meta.id) {
                let mut flat = vec![];
                cartero_model::tree::walk(&t.item, &mut flat, 0);
                for (it, _) in flat.into_iter().filter(|(i, _)| !i.is_folder()) {
                    let path = cartero_model::tree::ancestors(&t.item, it.id()).unwrap_or_default().iter().map(|a| a.name.clone()).collect::<Vec<_>>();
                    let mut p = vec![meta.name.clone()];
                    p.extend(path);
                    all.push(Entry::Request {
                        collection: meta.id.clone(),
                        item: it.id().to_string(),
                        method: it.request.as_ref().map(|r| r.method.clone()).unwrap_or_default(),
                        name: it.name.clone(),
                        path: p.join(" / "),
                    });
                }
            }
        }
    }
    all.extend(commands());
    let all = Rc::new(all);
    let run = {
        let main = main.clone();
        Rc::new(move |e: &Entry, window: &mut Window, cx: &mut App| {
            window.close_dialog(cx);
            match e.clone() {
                Entry::Request { collection, item, .. } => main.update(cx, |m, cx| m.open_item_pub(collection, item, window, cx)),
                Entry::Command { run, .. } => main.update(cx, |m, cx| run(m, window, cx)),
            }
        })
    };
    let filter = |all: &[Entry], q: &str| -> Vec<Entry> {
        let q = q.to_lowercase();
        all.iter()
            .filter(|e| match e {
                Entry::Request { name, path, method, .. } => q.is_empty() || q.split_whitespace().all(|w| name.to_lowercase().contains(w) || path.to_lowercase().contains(w) || method.to_lowercase() == w),
                Entry::Command { label, .. } => q.is_empty() || label.to_lowercase().contains(&q),
            })
            .take(40)
            .cloned()
            .collect()
    };
    {
        let all = all.clone();
        let run = run.clone();
        let sub = window.subscribe(&input, cx, move |input, ev: &InputEvent, window, cx| {
            if let InputEvent::PressEnter { .. } = ev {
                let q = input.read(cx).value().to_string();
                if let Some(first) = filter(&all, &q).first() {
                    run(first, window, cx);
                }
            }
        });
        // La suscripción vive mientras exista el diálogo: se guarda en el propio estado
        std::mem::forget(sub);
    }
    window.open_dialog(cx, move |dialog, _, cx| {
        let q = input.read(cx).value().to_string();
        let results = filter(&all, &q);
        let muted = cx.theme().muted_foreground;
        let rows = results.into_iter().enumerate().map(|(i, e)| {
            let run = run.clone();
            let row = div().id(("palette", i)).h_flex().gap_2().px_2().py_1p5().rounded(px(6.)).cursor_pointer().hover(|s| s.bg(cx.theme().accent)).text_sm();
            let row = match &e {
                Entry::Request { method, name, path, .. } => row.child(method_label(method, cx)).child(div().flex_1().min_w_0().truncate().child(name.clone())).child(div().text_xs().text_color(muted).truncate().max_w(px(260.)).child(path.clone())),
                Entry::Command { label, icon, .. } => row.child(div().w(px(34.)).text_color(muted).child(Icon::new(*icon).size_4())).child(label.clone()),
            };
            row.on_click(move |_, window, cx| run(&e, window, cx))
        });
        dialog.w(px(640.)).margin_top(px(80.)).close_button(false).child(div().v_flex().gap_2().child(Input::new(&input)).child(div().id("palette-list").max_h(px(420.)).overflow_y_scroll().v_flex().children(rows)))
    });
}
