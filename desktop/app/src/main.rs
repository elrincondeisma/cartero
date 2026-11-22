//! F0 · Prueba de riesgo de la interfaz: ventana, paneles redimensionables y editor JSON grande.
use gpui_kit::component::input::*;
use gpui_kit::component::label::Label;
use gpui_kit::component::*;
use gpui_kit::*;
use std::sync::OnceLock;
use std::time::Instant;

/// Momento de arranque, para medir el primer fotograma (prueba de rendimiento F0)
static START: OnceLock<Instant> = OnceLock::new();

struct Spike {
    editor: Entity<EditorState>,
    first_frame: bool,
}

impl Spike {
    fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let big = std::env::var("CARTERO_SPIKE_FILE").ok().and_then(|p| std::fs::read_to_string(p).ok());
        let editor = cx.new(|cx| {
            EditorState::new(window, cx)
                .language("json".to_string())
                .line_number(true)
                .soft_wrap(false)
                .default_value(big.unwrap_or_else(|| "{\n  \"hola\": \"Cartero\"\n}".into()))
        });
        eprintln!("editor creado: {:?}", START.get().unwrap().elapsed());
        Self { editor, first_frame: true }
    }
}

impl Render for Spike {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        if std::mem::take(&mut self.first_frame) {
            eprintln!("primer render: {:?}", START.get().unwrap().elapsed());
        }
        div().v_flex().size_full().child(div().p_2().child(Label::new("Cartero · F0"))).child(Editor::new(&self.editor).h_full())
    }
}

fn main() {
    START.get_or_init(Instant::now);
    gpui_kit::application().run(move |cx| {
        gpui_kit::init(cx);
        gpui_kit::open_window(WindowOptions::default(), cx, |window, cx| cx.new(|cx| Spike::new(window, cx)))
            .expect("No se pudo abrir la ventana");
    });
}
