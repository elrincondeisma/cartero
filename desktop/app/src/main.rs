#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
//! Cartero de escritorio: cliente de APIs nativo, con tus colecciones en este ordenador y,
//! si quieres, sincronizadas con un servidor de Cartero.

mod assets;
mod connect;
mod i18n;
mod oauth2;
mod runtime;
mod sample;
mod settings;
mod state;
mod sync_engine;
mod theme;
mod ui;
mod update;

use gpui_kit::*;

fn main() {
    // Idioma del sistema para los datos de ejemplo de la primera vez; luego, el de los ajustes
    i18n::set_english(i18n::system_prefers_english());
    let state = match state::AppState::open() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("No se pudo abrir la base de datos de Cartero: {e}");
            std::process::exit(1);
        }
    };
    i18n::set_english(state.settings.english());
    gpui_kit::application().with_assets(assets::Assets).run(move |cx| {
        gpui_kit::init(cx);
        ui::window::bind_keys(cx);
        let theme_choice = state.settings.theme;
        theme::apply(theme_choice, None, cx);
        let app = cx.new(|_| state);
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::centered(size(px(1360.), px(860.)), cx)),
            window_min_size: Some(size(px(900.), px(560.))),
            app_id: Some("cartero".into()),
            ..gpui_kit::component::TitleBar::window_options()
        };
        gpui_kit::open_window(options, cx, |window, cx| {
            theme::apply(theme_choice, Some(window), cx);
            cx.new(|cx| ui::window::MainWindow::new(app.clone(), window, cx))
        })
        .expect("No se pudo abrir la ventana");
        cx.on_window_closed(|cx, _| {
            if cx.windows().is_empty() {
                cx.quit();
            }
        })
        .detach();
        cx.activate(true);
    });
}
