//! Barra lateral: colecciones (árbol con menús y arrastrar y soltar), entornos e historial.

use std::collections::HashSet;

use cartero_model::{Item, Request};
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::list::ListItem;
use gpui_kit::component::menu::PopupMenuItem;
use gpui_kit::component::notification::Notification;
use gpui_kit::component::tree::{TreeEvent, TreeItem, TreeState, tree};

use crate::state::{AppState, StateEvent};
use crate::ui::dialogs;
use crate::ui::prelude::*;
use crate::ui::widgets::{empty_state, method_label, relative_time};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Panel {
    Collections,
    Environments,
    History,
}

/// Lo que la barra lateral pide a la ventana.
pub enum SidebarEvent {
    OpenItem { collection: String, item: String },
    OpenHistory(cartero_store::HistoryEntry),
    OpenEnvironment(String),
    OpenGlobals,
    OpenCollectionSettings { collection: String, folder: Option<String> },
    RunCollection { collection: String, folder: Option<String> },
}

type MenuAction = Box<dyn Fn(&mut Sidebar, &mut Window, &mut Context<Sidebar>)>;

/// Lo que se arrastra en el árbol.
#[derive(Clone)]
struct DragNode {
    collection: String,
    item: String,
    label: SharedString,
}

impl Render for DragNode {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .px_2()
            .py_1()
            .rounded(px(4.))
            .bg(cx.theme().popover)
            .border_1()
            .border_color(cx.theme().border)
            .text_sm()
            .shadow_md()
            .child(self.label.clone())
    }
}

/// Qué representa cada fila del árbol (codificado en su id).
#[derive(Clone, Debug, PartialEq)]
enum Node {
    Collection(String),
    Folder(String, String),
    Request(String, String),
}

impl Node {
    fn id(&self) -> String {
        match self {
            Node::Collection(c) => format!("c|{c}"),
            Node::Folder(c, i) => format!("f|{c}|{i}"),
            Node::Request(c, i) => format!("r|{c}|{i}"),
        }
    }
    fn parse(id: &str) -> Option<Node> {
        let parts: Vec<&str> = id.split('|').collect();
        Some(match parts.as_slice() {
            ["c", c] => Node::Collection(c.to_string()),
            ["f", c, i] => Node::Folder(c.to_string(), i.to_string()),
            ["r", c, i] => Node::Request(c.to_string(), i.to_string()),
            _ => return None,
        })
    }
    fn collection(&self) -> &str {
        match self {
            Node::Collection(c) | Node::Folder(c, _) | Node::Request(c, _) => c,
        }
    }
}

pub struct Sidebar {
    app: Entity<AppState>,
    pub panel: Panel,
    tree: Entity<TreeState>,
    expanded: HashSet<String>,
    filter: Entity<InputState>,
    history_filter: Entity<InputState>,
    _subs: Vec<Subscription>,
}

impl EventEmitter<SidebarEvent> for Sidebar {}

impl Sidebar {
    pub fn new(app: Entity<AppState>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let tree = cx.new(|cx| TreeState::new(cx));
        let filter = cx.new(|cx| InputState::new(window, cx).placeholder(tr("Buscar peticiones")));
        let history_filter = cx.new(|cx| InputState::new(window, cx).placeholder(tr("Buscar en el historial")));
        let mut expanded = HashSet::new();
        // La primera colección empieza abierta
        if let Some(first) = app.read(cx).collections.first() {
            expanded.insert(Node::Collection(first.id.clone()).id());
        }
        let mut this = Self { app: app.clone(), panel: Panel::Collections, tree, expanded, filter, history_filter, _subs: vec![] };
        let tree = this.tree.clone();
        this._subs.push(cx.subscribe(&tree, |this, _, ev: &TreeEvent, _| match ev {
            TreeEvent::Expanded(id) => {
                this.expanded.insert(id.to_string());
            }
            TreeEvent::Collapsed(id) => {
                this.expanded.remove(id.as_ref());
            }
        }));
        this._subs.push(cx.subscribe(&app, |this, _, ev: &StateEvent, cx| {
            if matches!(ev, StateEvent::Collections | StateEvent::Workspace) {
                this.rebuild(cx);
            }
            cx.notify();
        }));
        let filter = this.filter.clone();
        this._subs.push(cx.subscribe(&filter, |this, _, ev: &InputEvent, cx| {
            if matches!(ev, InputEvent::Change) {
                this.rebuild(cx);
            }
        }));
        let hf = this.history_filter.clone();
        this._subs.push(cx.subscribe(&hf, |_, _, _: &InputEvent, cx| cx.notify()));
        this.rebuild(cx);
        this
    }

    pub fn set_panel(&mut self, panel: Panel, cx: &mut Context<Self>) {
        self.panel = panel;
        cx.notify();
    }

    pub fn focus_filter(&self, window: &mut Window, cx: &mut App) {
        self.filter.update(cx, |s, cx| s.focus(window, cx));
    }

    /// Vuelve a montar el árbol desde el estado, conservando lo desplegado.
    pub fn rebuild(&mut self, cx: &mut Context<Self>) {
        let query = self.filter.read(cx).value().to_lowercase();
        let app = self.app.read(cx);
        let mut roots = vec![];
        fn build(items: &[Item], collection: &str, expanded: &HashSet<String>, query: &str) -> Vec<TreeItem> {
            items
                .iter()
                .filter_map(|it| {
                    if it.is_folder() {
                        let node = Node::Folder(collection.to_string(), it.id().to_string());
                        let children = build(it.children(), collection, expanded, query);
                        if !query.is_empty() && children.is_empty() && !it.name.to_lowercase().contains(query) {
                            return None;
                        }
                        let open = !query.is_empty() || expanded.contains(&node.id());
                        Some(TreeItem::new(node.id(), it.name.clone()).children(children).expanded(open))
                    } else {
                        let url = it.request.as_ref().map(|r| r.url.raw()).unwrap_or_default().to_lowercase();
                        if !query.is_empty() && !it.name.to_lowercase().contains(query) && !url.contains(query) {
                            return None;
                        }
                        Some(TreeItem::new(Node::Request(collection.to_string(), it.id().to_string()).id(), it.name.clone()))
                    }
                })
                .collect()
        }
        for meta in &app.collections {
            let Some(c) = app.trees.get(&meta.id) else { continue };
            let node = Node::Collection(meta.id.clone());
            let children = build(&c.item, &meta.id, &self.expanded, &query);
            if !query.is_empty() && children.is_empty() && !meta.name.to_lowercase().contains(&query) {
                continue;
            }
            let open = !query.is_empty() || self.expanded.contains(&node.id());
            roots.push(TreeItem::new(node.id(), meta.name.clone()).children(children).expanded(open));
        }
        self.tree.update(cx, |t, cx| t.set_items(roots, cx));
        cx.notify();
    }

    fn method_of(&self, collection: &str, item: &str, cx: &App) -> Option<String> {
        let app = self.app.read(cx);
        let c = app.trees.get(collection)?;
        cartero_model::tree::find(&c.item, item).and_then(|i| i.request.as_ref()).map(|r| r.method.clone())
    }

    // ─────────────────────────── Acciones ───────────────────────────

    fn new_collection(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let app = self.app.clone();
        dialogs::prompt_text(
            tr("Nueva colección"),
            tr("Nombre de la colección"),
            tr("Mi colección").to_string(),
            tr("Crear"),
            window,
            cx,
            move |name, _, cx| {
                let ws = app.read(cx).workspace.id.clone();
                let _ = app.read(cx).store.create_collection(&ws, &name);
                app.update(cx, |a, cx| a.reload_collections(cx));
            },
        );
    }

    fn new_folder(&mut self, collection: String, parent: Option<String>, window: &mut Window, cx: &mut Context<Self>) {
        let app = self.app.clone();
        let node_id = match &parent {
            Some(p) => Node::Folder(collection.clone(), p.clone()).id(),
            None => Node::Collection(collection.clone()).id(),
        };
        self.expanded.insert(node_id);
        dialogs::prompt_text(
            tr("Nueva carpeta"),
            tr("Nombre de la carpeta"),
            tr("Carpeta nueva").to_string(),
            tr("Crear"),
            window,
            cx,
            move |name, _, cx| {
                let _ = app.read(cx).store.create_item(&collection, parent.as_deref(), usize::MAX, &Item::folder(&name));
                app.update(cx, |a, cx| a.reload_collections(cx));
            },
        );
    }

    fn new_request_in(&mut self, collection: String, parent: Option<String>, cx: &mut Context<Self>) {
        let node_id = match &parent {
            Some(p) => Node::Folder(collection.clone(), p.clone()).id(),
            None => Node::Collection(collection.clone()).id(),
        };
        self.expanded.insert(node_id);
        let item = Item::request(tr("Petición nueva").as_ref(), Request::new("GET", ""));
        let id = self.app.read(cx).store.create_item(&collection, parent.as_deref(), usize::MAX, &item);
        if let Ok(id) = id {
            self.app.update(cx, |a, cx| a.reload_collections(cx));
            cx.emit(SidebarEvent::OpenItem { collection, item: id });
        }
    }

    fn rename(&mut self, node: Node, window: &mut Window, cx: &mut Context<Self>) {
        let app = self.app.clone();
        let current = {
            let a = app.read(cx);
            match &node {
                Node::Collection(c) => a.collections.iter().find(|m| &m.id == c).map(|m| m.name.clone()),
                Node::Folder(c, i) | Node::Request(c, i) => {
                    a.trees.get(c).and_then(|t| cartero_model::tree::find(&t.item, i)).map(|i| i.name.clone())
                }
            }
        }
        .unwrap_or_default();
        dialogs::prompt_text(tr("Renombrar"), tr("Nombre nuevo"), current, tr("Renombrar"), window, cx, move |name, _, cx| {
            let store = app.read(cx).store.clone();
            match &node {
                Node::Collection(c) => {
                    let _ = store.rename_collection(c, &name);
                }
                Node::Folder(_, i) | Node::Request(_, i) => {
                    let _ = store.rename_item(i, &name);
                }
            }
            app.update(cx, |a, cx| {
                a.reload_collections(cx);
                if let Node::Request(_, i) | Node::Folder(_, i) = &node {
                    cx.emit(StateEvent::ItemChanged(i.clone()));
                }
            });
        });
    }

    fn duplicate(&mut self, node: Node, cx: &mut Context<Self>) {
        let store = self.app.read(cx).store.clone();
        let _ = match &node {
            Node::Collection(c) => store.duplicate_collection(c),
            Node::Folder(_, i) | Node::Request(_, i) => store.duplicate_item(i),
        };
        self.app.update(cx, |a, cx| a.reload_collections(cx));
    }

    fn delete(&mut self, node: Node, window: &mut Window, cx: &mut Context<Self>) {
        let app = self.app.clone();
        let (title, body) = match &node {
            Node::Collection(_) => {
                (tr("Eliminar la colección"), tr("Se borrarán la colección y todas sus peticiones. No se puede deshacer."))
            }
            Node::Folder(..) => (tr("Eliminar la carpeta"), tr("Se borrarán la carpeta y todo lo que contiene. No se puede deshacer.")),
            Node::Request(..) => (tr("Eliminar la petición"), tr("La petición se borrará. No se puede deshacer.")),
        };
        dialogs::confirm(title, body, tr("Eliminar"), window, cx, move |_, cx| {
            let store = app.read(cx).store.clone();
            let deleted: Vec<String> = match &node {
                Node::Collection(c) => {
                    let ids = app.read(cx).trees.get(c).map(|t| {
                        let mut flat = vec![];
                        cartero_model::tree::walk(&t.item, &mut flat, 0);
                        flat.iter().map(|(i, _)| i.id().to_string()).collect()
                    });
                    let _ = store.delete_collection(c);
                    ids.unwrap_or_default()
                }
                Node::Folder(_, i) | Node::Request(_, i) => {
                    let _ = store.delete_item(i);
                    vec![i.clone()]
                }
            };
            app.update(cx, |a, cx| {
                a.reload_collections(cx);
                for id in deleted {
                    cx.emit(StateEvent::ItemDeleted(id));
                }
            });
        });
    }

    fn export(&mut self, collection: String, window: &mut Window, cx: &mut Context<Self>) {
        let Ok(c) = self.app.read(cx).store.collection(&collection) else { return };
        let json = serde_json::to_string_pretty(&cartero_model::export::collection(&c)).unwrap_or_default();
        let dir = dirs::download_dir().unwrap_or_else(std::env::temp_dir);
        let file = format!("{}.postman_collection.json", c.info.name.replace(['/', '\\'], "-"));
        let rx = cx.prompt_for_new_path(&dir, Some(&file));
        cx.spawn_in(window, async move |_, cx| {
            if let Ok(Ok(Some(path))) = rx.await {
                let ok = std::fs::write(&path, json).is_ok();
                let _ = cx.update(|window, cx| {
                    if ok {
                        window.push_notification(Notification::success(tr("Colección exportada en formato Postman v2.1")), cx);
                    } else {
                        window.push_notification(Notification::error(tr("No se pudo guardar el fichero")), cx);
                    }
                });
            }
        })
        .detach();
    }

    fn copy_curl(&mut self, collection: String, item: String, window: &mut Window, cx: &mut Context<Self>) {
        let app = self.app.read(cx);
        let Some(c) = app.trees.get(&collection) else { return };
        let Some(it) = cartero_model::tree::find(&c.item, &item) else { return };
        let ctx = app.run_context(Some(&collection), it);
        let auth = cartero_model::tree::effective_auth(c, &item).map(|(a, _)| a.clone());
        let p = cartero_model::prepare::prepare(it.request.as_ref().unwrap_or(&Default::default()), &ctx.vars.layers(), auth.as_ref());
        cx.write_to_clipboard(ClipboardItem::new_string(cartero_model::codegen::generate(cartero_model::codegen::Language::Curl, &p)));
        window.push_notification(Notification::success(tr("Copiado como cURL")), cx);
    }

    /// Soltar `drag` sobre `target`: dentro si es carpeta o colección; si es una petición, encima.
    fn drop_on(&mut self, drag: &DragNode, target: Node, window: &mut Window, cx: &mut Context<Self>) {
        let store = self.app.read(cx).store.clone();
        let (collection, parent, index) = match &target {
            Node::Collection(c) => (c.clone(), None, usize::MAX),
            Node::Folder(c, f) => {
                self.expanded.insert(target.id());
                (c.clone(), Some(f.clone()), usize::MAX)
            }
            Node::Request(c, r) => {
                let app = self.app.read(cx);
                let Some(tree) = app.trees.get(c) else { return };
                let parent = cartero_model::tree::ancestors(&tree.item, r).and_then(|a| a.last().map(|p| p.id().to_string()));
                let siblings: Vec<String> = match &parent {
                    Some(p) => cartero_model::tree::find(&tree.item, p)
                        .map(|f| f.children().iter().map(|i| i.id().to_string()).collect())
                        .unwrap_or_default(),
                    None => tree.item.iter().map(|i| i.id().to_string()).collect(),
                };
                let siblings: Vec<String> = siblings.into_iter().filter(|s| *s != drag.item).collect();
                let pos = siblings.iter().position(|s| s == r).unwrap_or(siblings.len());
                (c.clone(), parent, pos)
            }
        };
        if Some(drag.item.as_str()) == parent.as_deref() || matches!(&target, Node::Request(_, r) if *r == drag.item) {
            return;
        }
        let _ = drag.collection.as_str();
        match store.move_item(&drag.item, &collection, parent.as_deref(), index) {
            Ok(()) => self.app.update(cx, |a, cx| a.reload_collections(cx)),
            Err(e) => window.push_notification(Notification::warning(e.to_string()), cx),
        }
    }

    // ─────────────────────────── Vistas ───────────────────────────

    fn render_collections(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let entity = cx.entity();
        let muted = cx.theme().muted_foreground;
        let has = !self.app.read(cx).collections.is_empty();
        let header = div()
            .h_flex()
            .gap_1()
            .px_3()
            .pt_3()
            .pb_2()
            .child(div().flex_1().text_sm().font_semibold().child(tr("Colecciones")))
            .child(
                Button::new("new-collection")
                    .ghost()
                    .xsmall()
                    .icon(IconName::Plus)
                    .tooltip(tr("Nueva colección"))
                    .on_click(cx.listener(|this, _, w, cx| this.new_collection(w, cx))),
            )
            .child(
                Button::new("import")
                    .ghost()
                    .xsmall()
                    .icon(IconName::Import)
                    .tooltip(tr("Importar (Postman, cURL…)"))
                    .on_click(cx.listener(|this, _, w, cx| dialogs::import(this.app.clone(), w, cx))),
            );
        if !has {
            return div()
                .v_flex()
                .size_full()
                .child(header)
                .child(
                    empty_state(
                        IconName::Folder,
                        tr("Sin colecciones"),
                        tr("Crea una colección para guardar tus peticiones, o importa una de Postman."),
                        cx,
                    )
                    .child(
                        Button::new("empty-new")
                            .primary()
                            .small()
                            .label(tr("Nueva colección"))
                            .on_click(cx.listener(|this, _, w, cx| this.new_collection(w, cx))),
                    )
                    .child(
                        Button::new("empty-import")
                            .outline()
                            .small()
                            .label(tr("Importar"))
                            .on_click(cx.listener(|this, _, w, cx| dialogs::import(this.app.clone(), w, cx))),
                    ),
                )
                .into_any_element();
        }
        let render_entity = entity.clone();
        let tree_el = tree(&self.tree, move |ix, entry, _selected, _, cx| {
            let id = entry.item().id.to_string();
            let node = Node::parse(&id);
            let label = entry.item().label.clone();
            let depth = entry.depth();
            let expanded = entry.is_expanded();
            let entity = render_entity.clone();
            let mut row = div().h_flex().gap_1p5().w_full().pl(px(depth as f32 * 14.)).text_sm();
            match &node {
                Some(Node::Collection(_)) | Some(Node::Folder(..)) => {
                    let icon = match (&node, expanded) {
                        (Some(Node::Collection(_)), _) => IconName::Package,
                        (_, true) => IconName::FolderOpen,
                        _ => IconName::Folder,
                    };
                    row = row
                        .child(
                            div()
                                .text_color(cx.theme().muted_foreground)
                                .child(Icon::new(if expanded { IconName::ChevronDown } else { IconName::ChevronRight }).size_3()),
                        )
                        .child(div().text_color(cx.theme().muted_foreground).child(Icon::new(icon).size_4()))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .truncate()
                                .when(matches!(node, Some(Node::Collection(_))), |d| d.font_semibold())
                                .child(label.clone()),
                        );
                }
                Some(Node::Request(c, i)) => {
                    let method = entity.read(cx).method_of(c, i, cx).unwrap_or_else(|| "GET".into());
                    row = row
                        .child(div().w(px(16.)))
                        .child(method_label(&method, cx))
                        .child(div().flex_1().min_w_0().truncate().child(label.clone()));
                }
                None => {}
            }
            let drag_value = node.as_ref().and_then(|n| match n {
                Node::Folder(c, i) | Node::Request(c, i) => Some(DragNode { collection: c.clone(), item: i.clone(), label: label.clone() }),
                Node::Collection(_) => None,
            });
            let drop_target = node.clone();
            let drop_entity = entity.clone();
            let mut wrapper = div().id(("node", ix)).w_full().child(row);
            if let Some(dv) = drag_value {
                wrapper = wrapper.on_drag(dv, |dv, _, _, cx| cx.new(|_| dv.clone()));
            }
            if let Some(target) = drop_target {
                let brand = crate::theme::brand();
                wrapper = wrapper.drag_over::<DragNode>(move |s, _, _, _| s.border_t_2().border_color(brand)).on_drop(
                    move |drag: &DragNode, window, cx| {
                        let target = target.clone();
                        drop_entity.update(cx, |this, cx| this.drop_on(drag, target, window, cx));
                    },
                );
            }
            let click_node = node.clone();
            ListItem::new(ix).py_0p5().child(wrapper).on_click(move |ev, _, cx| {
                if let Some(Node::Request(c, i)) = &click_node {
                    let _ = ev;
                    entity.update(cx, |_, cx| cx.emit(SidebarEvent::OpenItem { collection: c.clone(), item: i.clone() }));
                }
            })
        })
        .context_menu(move |_, entry, menu, window, cx| {
            let Some(node) = Node::parse(&entry.item().id) else { return menu };
            let e = entity.clone();
            let item = |label: SharedString, icon: IconName, f: MenuAction| {
                let e = e.clone();
                PopupMenuItem::new(label).icon(icon).on_click(move |_, window, cx| e.update(cx, |this, cx| f(this, window, cx)))
            };
            let _ = (window, cx);
            let c = node.collection().to_string();
            let mut menu = menu;
            match node.clone() {
                Node::Collection(cid) => {
                    let (c1, c2, c3, c4, c5, c6) = (cid.clone(), cid.clone(), cid.clone(), cid.clone(), cid.clone(), cid.clone());
                    menu = menu
                        .item(item(
                            tr("Nueva petición"),
                            IconName::FilePlus,
                            Box::new(move |s, _, cx| s.new_request_in(c1.clone(), None, cx)),
                        ))
                        .item(item(
                            tr("Nueva carpeta"),
                            IconName::FolderPlus,
                            Box::new(move |s, w, cx| s.new_folder(c2.clone(), None, w, cx)),
                        ))
                        .separator()
                        .item(item(
                            tr("Ejecutar la colección"),
                            IconName::Play,
                            Box::new(move |_, _, cx| cx.emit(SidebarEvent::RunCollection { collection: c3.clone(), folder: None })),
                        ))
                        .item(item(
                            tr("Auth, scripts y variables"),
                            IconName::Settings,
                            Box::new(move |_, _, cx| {
                                cx.emit(SidebarEvent::OpenCollectionSettings { collection: c4.clone(), folder: None })
                            }),
                        ))
                        .item(item(
                            tr("Exportar (Postman v2.1)"),
                            IconName::Download,
                            Box::new(move |s, w, cx| s.export(c5.clone(), w, cx)),
                        ))
                        .separator()
                        .item(item(
                            tr("Renombrar"),
                            IconName::Pencil,
                            Box::new({
                                let n = node.clone();
                                move |s, w, cx| s.rename(n.clone(), w, cx)
                            }),
                        ))
                        .item(item(
                            tr("Duplicar"),
                            IconName::Copy,
                            Box::new({
                                let n = node.clone();
                                move |s, _, cx| s.duplicate(n.clone(), cx)
                            }),
                        ))
                        .item(item(
                            tr("Eliminar"),
                            IconName::Trash,
                            Box::new({
                                let n = Node::Collection(c6.clone());
                                move |s, w, cx| s.delete(n.clone(), w, cx)
                            }),
                        ));
                }
                Node::Folder(_, fid) => {
                    let (c1, c2, c3, c4) = (c.clone(), c.clone(), c.clone(), c.clone());
                    let (f1, f2, f3, f4) = (fid.clone(), fid.clone(), fid.clone(), fid.clone());
                    menu = menu
                        .item(item(
                            tr("Nueva petición"),
                            IconName::FilePlus,
                            Box::new(move |s, _, cx| s.new_request_in(c1.clone(), Some(f1.clone()), cx)),
                        ))
                        .item(item(
                            tr("Nueva carpeta"),
                            IconName::FolderPlus,
                            Box::new(move |s, w, cx| s.new_folder(c2.clone(), Some(f2.clone()), w, cx)),
                        ))
                        .separator()
                        .item(item(
                            tr("Ejecutar la carpeta"),
                            IconName::Play,
                            Box::new(move |_, _, cx| {
                                cx.emit(SidebarEvent::RunCollection { collection: c3.clone(), folder: Some(f3.clone()) })
                            }),
                        ))
                        .item(item(
                            tr("Auth y scripts de la carpeta"),
                            IconName::Settings,
                            Box::new(move |_, _, cx| {
                                cx.emit(SidebarEvent::OpenCollectionSettings { collection: c4.clone(), folder: Some(f4.clone()) })
                            }),
                        ))
                        .separator();
                    for (label, icon, kind) in
                        [(tr("Renombrar"), IconName::Pencil, 0), (tr("Duplicar"), IconName::Copy, 1), (tr("Eliminar"), IconName::Trash, 2)]
                    {
                        let n = node.clone();
                        menu = menu.item(item(
                            label,
                            icon,
                            Box::new(move |s, w, cx| match kind {
                                0 => s.rename(n.clone(), w, cx),
                                1 => s.duplicate(n.clone(), cx),
                                _ => s.delete(n.clone(), w, cx),
                            }),
                        ));
                    }
                }
                Node::Request(_, rid) => {
                    let (c1, c2, r1, r2) = (c.clone(), c.clone(), rid.clone(), rid.clone());
                    menu = menu
                        .item(item(
                            tr("Abrir"),
                            IconName::ArrowUpRight,
                            Box::new(move |_, _, cx| cx.emit(SidebarEvent::OpenItem { collection: c1.clone(), item: r1.clone() })),
                        ))
                        .item(item(
                            tr("Copiar como cURL"),
                            IconName::Terminal,
                            Box::new(move |s, w, cx| s.copy_curl(c2.clone(), r2.clone(), w, cx)),
                        ))
                        .separator();
                    for (label, icon, kind) in
                        [(tr("Renombrar"), IconName::Pencil, 0), (tr("Duplicar"), IconName::Copy, 1), (tr("Eliminar"), IconName::Trash, 2)]
                    {
                        let n = node.clone();
                        menu = menu.item(item(
                            label,
                            icon,
                            Box::new(move |s, w, cx| match kind {
                                0 => s.rename(n.clone(), w, cx),
                                1 => s.duplicate(n.clone(), cx),
                                _ => s.delete(n.clone(), w, cx),
                            }),
                        ));
                    }
                }
            }
            menu
        });
        let _ = muted;
        div()
            .v_flex()
            .size_full()
            .child(header)
            .child(div().px_3().pb_2().child(Input::new(&self.filter).small().prefix(Icon::new(IconName::Search).size_3())))
            .child(div().flex_1().min_h_0().px_1().child(tree_el))
            .into_any_element()
    }

    fn new_environment(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let app = self.app.clone();
        dialogs::prompt_text(
            tr("Nuevo entorno"),
            tr("Nombre del entorno (por ejemplo, Local o Producción)"),
            tr("Local").to_string(),
            tr("Crear"),
            window,
            cx,
            move |name, _, cx| {
                let ws = app.read(cx).workspace.id.clone();
                let env = cartero_model::Environment { id: None, name, values: vec![] };
                let id = app.read(cx).store.create_environment(&ws, &env).ok();
                app.update(cx, |a, cx| {
                    a.reload_environments(cx);
                    if let Some(id) = id {
                        cx.emit(StateEvent::Environments);
                        a.set_active_env(Some(id), cx);
                    }
                });
            },
        );
    }

    fn render_environments(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let app = self.app.read(cx);
        let active = app.active_env.clone();
        let envs = app.environments.clone();
        let globals = app.globals.len();
        let muted = cx.theme().muted_foreground;
        let brand = crate::theme::brand();
        let rows = envs.into_iter().enumerate().map(|(i, e)| {
            let is_active = active.as_deref() == Some(e.id.as_str());
            let (id1, id2, id3) = (e.id.clone(), e.id.clone(), e.id.clone());
            ListItem::new(("env", i))
                .child(
                    div()
                        .h_flex()
                        .gap_2()
                        .w_full()
                        .text_sm()
                        .child(
                            div()
                                .size_2()
                                .rounded_full()
                                .when(is_active, |d| d.bg(brand))
                                .when(!is_active, |d| d.border_1().border_color(muted)),
                        )
                        .child(div().flex_1().truncate().child(e.name.clone()))
                        .child(
                            Button::new(("env-use", i))
                                .ghost()
                                .xsmall()
                                .label(if is_active { tr("Activo") } else { tr("Usar") })
                                .disabled(is_active)
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    let id = id1.clone();
                                    this.app.update(cx, |a, cx| a.set_active_env(Some(id), cx));
                                })),
                        )
                        .child(Button::new(("env-del", i)).ghost().xsmall().icon(IconName::Trash).tooltip(tr("Eliminar")).on_click(
                            cx.listener(move |this, _, window, cx| {
                                let app = this.app.clone();
                                let id = id3.clone();
                                dialogs::confirm(
                                    tr("Eliminar el entorno"),
                                    tr("Se borrará el entorno con todas sus variables. No se puede deshacer."),
                                    tr("Eliminar"),
                                    window,
                                    cx,
                                    move |_, cx| {
                                        let _ = app.read(cx).store.delete_environment(&id);
                                        app.update(cx, |a, cx| a.reload_environments(cx));
                                    },
                                );
                            }),
                        )),
                )
                .on_click(cx.listener(move |_, _, _, cx| cx.emit(SidebarEvent::OpenEnvironment(id2.clone()))))
        });
        div()
            .v_flex()
            .size_full()
            .child(
                div().h_flex().px_3().pt_3().pb_2().child(div().flex_1().text_sm().font_semibold().child(tr("Entornos"))).child(
                    Button::new("new-env")
                        .ghost()
                        .xsmall()
                        .icon(IconName::Plus)
                        .tooltip(tr("Nuevo entorno"))
                        .on_click(cx.listener(|this, _, w, cx| this.new_environment(w, cx))),
                ),
            )
            .child(
                div()
                    .px_3()
                    .pb_2()
                    .text_xs()
                    .text_color(muted)
                    .child(tr("Un entorno es un juego de variables (URL base, tokens…). El activo se usa al enviar.")),
            )
            .child(
                div().id("env-list").flex_1().overflow_y_scroll().px_1().children(rows).child(
                    ListItem::new("globals")
                        .child(
                            div()
                                .h_flex()
                                .gap_2()
                                .text_sm()
                                .child(Icon::new(IconName::Globe).size_4())
                                .child(div().flex_1().child(tr("Variables globales")))
                                .child(div().text_xs().text_color(muted).child(globals.to_string())),
                        )
                        .on_click(cx.listener(|_, _, _, cx| cx.emit(SidebarEvent::OpenGlobals))),
                ),
            )
            .into_any_element()
    }

    fn render_history(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let q = self.history_filter.read(cx).value().to_lowercase();
        let history: Vec<cartero_store::HistoryEntry> =
            self.app.read(cx).history.iter().filter(|h| q.is_empty() || h.url.to_lowercase().contains(&q)).take(300).cloned().collect();
        let muted = cx.theme().muted_foreground;
        let empty = history.is_empty();
        let rows = history.into_iter().enumerate().map(|(i, h)| {
            let status_color = h.status.map(|s| crate::theme::status_color(s, cx)).unwrap_or(cx.theme().danger);
            let entry = h.clone();
            ListItem::new(("hist", i))
                .child(
                    div()
                        .v_flex()
                        .w_full()
                        .child(
                            div()
                                .h_flex()
                                .gap_1()
                                .text_sm()
                                .child(method_label(&h.method, cx))
                                .child(div().flex_1().min_w_0().truncate().child(h.url.clone())),
                        )
                        .child(
                            div()
                                .h_flex()
                                .gap_2()
                                .pl(px(38.))
                                .text_xs()
                                .text_color(muted)
                                .child(
                                    div()
                                        .text_color(status_color)
                                        .child(h.status.map(|s| s.to_string()).unwrap_or_else(|| tr("error").to_string())),
                                )
                                .when_some(h.time_ms, |d, t| d.child(format!("{t} ms")))
                                .child(relative_time(&h.created_at)),
                        ),
                )
                .on_click(cx.listener(move |_, _, _, cx| cx.emit(SidebarEvent::OpenHistory(entry.clone()))))
        });
        div()
            .v_flex()
            .size_full()
            .child(div().h_flex().px_3().pt_3().pb_2().child(div().flex_1().text_sm().font_semibold().child(tr("Historial"))).child(
                Button::new("clear-history").ghost().xsmall().icon(IconName::Trash).tooltip(tr("Vaciar el historial")).on_click(
                    cx.listener(|this, _, window, cx| {
                        let app = this.app.clone();
                        dialogs::confirm(
                            tr("Vaciar el historial"),
                            tr("Se borrarán todas las peticiones del historial de este workspace."),
                            tr("Vaciar"),
                            window,
                            cx,
                            move |_, cx| {
                                let ws = app.read(cx).workspace.id.clone();
                                let _ = app.read(cx).store.clear_history(&ws);
                                app.update(cx, |a, cx| a.reload_history(cx));
                            },
                        );
                    }),
                ),
            ))
            .child(div().px_3().pb_2().child(Input::new(&self.history_filter).small().prefix(Icon::new(IconName::Search).size_3())))
            .child(if empty {
                empty_state(IconName::Clock, tr("Historial vacío"), tr("Cada petición que envíes queda aquí para repetirla."), cx)
                    .into_any_element()
            } else {
                div().id("history-list").flex_1().overflow_y_scroll().px_1().children(rows).into_any_element()
            })
            .into_any_element()
    }
}

impl Render for Sidebar {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let content = match self.panel {
            Panel::Collections => self.render_collections(cx),
            Panel::Environments => self.render_environments(cx),
            Panel::History => self.render_history(cx),
        };
        div().size_full().bg(cx.theme().sidebar).child(content)
    }
}
