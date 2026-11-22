//! Tema de Cartero: la misma paleta que la web (naranja de la marca, grises cálidos),
//! en claro y oscuro.

use std::rc::Rc;

use gpui_kit::component::highlighter::HighlightTheme;
use gpui_kit::component::{Theme, ThemeConfig, ThemeMode};
use gpui_kit::{App, Hsla, Window, rgb};

use crate::settings::ThemeChoice;

pub const BRAND: u32 = 0xea580c;

fn config(dark: bool) -> ThemeConfig {
    let src = if dark { include_str!("../assets/theme-dark.json") } else { include_str!("../assets/theme-light.json") };
    serde_json::from_str(src).expect("tema válido")
}

/// Aplica el tema elegido (o el del sistema).
pub fn apply(choice: ThemeChoice, window: Option<&mut Window>, cx: &mut App) {
    let dark = match choice {
        ThemeChoice::Dark => true,
        ThemeChoice::Light => false,
        ThemeChoice::System => window
            .as_ref()
            .map(|w| matches!(w.appearance(), gpui_kit::WindowAppearance::Dark | gpui_kit::WindowAppearance::VibrantDark))
            .unwrap_or(false),
    };
    let light = Rc::new(config(false));
    let darkc = Rc::new(config(true));
    Theme::update(cx, |t| {
        t.light_theme = light.clone();
        t.dark_theme = darkc.clone();
    });
    Theme::change(if dark { ThemeMode::Dark } else { ThemeMode::Light }, None, cx);
    // El editor de código usa su propio tema de resaltado
    Theme::update(cx, |t| {
        t.highlight_theme = if dark { HighlightTheme::default_dark() } else { HighlightTheme::default_light() };
    });
    cx.refresh_windows();
}

/// Color de cada método HTTP, como en la web.
pub fn method_color(method: &str, cx: &App) -> Hsla {
    let dark = Theme::global(cx).is_dark();
    let c: u32 = match method.to_uppercase().as_str() {
        "GET" => {
            if dark {
                0x4ade80
            } else {
                0x15803d
            }
        }
        "POST" => {
            if dark {
                0xfbbf24
            } else {
                0xb45309
            }
        }
        "PUT" => {
            if dark {
                0x60a5fa
            } else {
                0x1d4ed8
            }
        }
        "PATCH" => {
            if dark {
                0xc084fc
            } else {
                0x7e22ce
            }
        }
        "DELETE" => {
            if dark {
                0xf87171
            } else {
                0xb91c1c
            }
        }
        "HEAD" | "OPTIONS" => {
            if dark {
                0x2dd4bf
            } else {
                0x0f766e
            }
        }
        _ => {
            if dark {
                0xa1a1aa
            } else {
                0x52525b
            }
        }
    };
    rgb(c).into()
}

/// Color del código de estado.
pub fn status_color(status: u16, cx: &App) -> Hsla {
    let dark = Theme::global(cx).is_dark();
    let c: u32 = match status {
        200..=299 => {
            if dark {
                0x4ade80
            } else {
                0x15803d
            }
        }
        300..=399 => {
            if dark {
                0x60a5fa
            } else {
                0x1d4ed8
            }
        }
        400..=499 => {
            if dark {
                0xfbbf24
            } else {
                0xb45309
            }
        }
        _ => {
            if dark {
                0xf87171
            } else {
                0xb91c1c
            }
        }
    };
    rgb(c).into()
}

pub fn brand() -> Hsla {
    rgb(BRAND).into()
}
