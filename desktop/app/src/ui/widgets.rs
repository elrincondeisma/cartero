//! Piezas pequeñas que se repiten en varias vistas.

use std::rc::Rc;

use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::menu::{DropdownMenu as _, PopupMenuItem};

use crate::ui::prelude::*;

/// Botón con menú de opciones; marca la elegida.
pub fn choice<T: Clone + PartialEq + 'static>(
    id: impl Into<ElementId>,
    current: &T,
    options: Vec<(SharedString, T)>,
    on_pick: impl Fn(T, &mut Window, &mut App) + 'static,
) -> impl IntoElement {
    let label = options.iter().find(|(_, v)| v == current).map(|(l, _)| l.clone()).unwrap_or_else(|| "—".into());
    let on_pick = Rc::new(on_pick);
    let current = current.clone();
    Button::new(id).outline().small().label(label).dropdown_caret(true).dropdown_menu(move |mut menu, _, _| {
        for (label, value) in options.iter().cloned() {
            let on_pick = on_pick.clone();
            let checked = value == current;
            menu = menu.item(PopupMenuItem::new(label).checked(checked).on_click(move |_, window, cx| on_pick(value.clone(), window, cx)));
        }
        menu
    })
}

/// Método HTTP con su color (GET verde, POST ámbar…).
pub fn method_label(method: &str, cx: &App) -> impl IntoElement + use<> {
    let short = match method.to_uppercase().as_str() {
        "DELETE" => "DEL".to_string(),
        "OPTIONS" => "OPT".to_string(),
        m => m.to_string(),
    };
    div().text_xs().font_semibold().text_color(crate::theme::method_color(method, cx)).w(px(38.)).flex_none().whitespace_nowrap().child(short)
}

/// Pantalla vacía con un mensaje y, si se pasa, una acción.
pub fn empty_state(icon: IconName, title: SharedString, body: SharedString, cx: &App) -> Div {
    div()
        .v_flex()
        .size_full()
        .items_center()
        .justify_center()
        .gap_2()
        .p_6()
        .child(div().text_color(cx.theme().muted_foreground).child(Icon::new(icon).size_8()))
        .child(div().text_base().font_semibold().child(title))
        .child(div().max_w(px(420.)).text_sm().text_center().text_color(cx.theme().muted_foreground).child(body))
}

/// Tamaño legible: 1.2 KB, 3.4 MB…
pub fn human_size(bytes: usize) -> String {
    let b = bytes as f64;
    if b < 1024.0 {
        format!("{bytes} B")
    } else if b < 1024.0 * 1024.0 {
        format!("{:.1} KB", b / 1024.0)
    } else {
        format!("{:.1} MB", b / 1024.0 / 1024.0)
    }
}

pub fn human_ms(d: std::time::Duration) -> String {
    let ms = d.as_secs_f64() * 1000.0;
    if ms < 1.0 {
        format!("{ms:.2} ms")
    } else if ms < 1000.0 {
        format!("{ms:.0} ms")
    } else {
        format!("{:.2} s", ms / 1000.0)
    }
}

/// Fecha relativa corta para el historial.
pub fn relative_time(iso: &str) -> String {
    let Ok(t) = chrono::DateTime::parse_from_rfc3339(iso) else { return String::new() };
    let secs = (chrono::Utc::now() - t.with_timezone(&chrono::Utc)).num_seconds().max(0);
    if secs < 60 {
        tr("ahora").to_string()
    } else if secs < 3600 {
        trf("hace {n} min", &[("n", &(secs / 60).to_string())]).to_string()
    } else if secs < 86400 {
        trf("hace {n} h", &[("n", &(secs / 3600).to_string())]).to_string()
    } else {
        t.format("%d/%m/%Y %H:%M").to_string()
    }
}
