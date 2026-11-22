//! Ajustes → Servidores (se completa con la sincronización).

use crate::state::AppState;
use crate::ui::prelude::*;

pub struct ServersPanel {
    _app: Entity<AppState>,
}

impl ServersPanel {
    pub fn new(app: Entity<AppState>, _window: &mut Window, _cx: &mut Context<Self>) -> Self {
        Self { _app: app }
    }
}

impl Render for ServersPanel {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div().child(tr("Servidores"))
    }
}
