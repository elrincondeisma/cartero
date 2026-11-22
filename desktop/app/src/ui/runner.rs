//! Runner: ejecuta una colección o carpeta con iteraciones, datos CSV/JSON, retardo y parada
//! al primer fallo, con resultados en vivo e informes JSON y JUnit.

use std::collections::HashSet;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use cartero_runner::data::Row;
use cartero_runner::{RunConfig, RunEvent, RunItemResult, RunSummary};
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::checkbox::Checkbox;
use gpui_kit::component::input::{Input, InputState};
use gpui_kit::component::notification::Notification;

use crate::state::AppState;
use crate::ui::prelude::*;
use crate::ui::request::TabEvent;
use crate::ui::widgets::{empty_state, method_label};

pub struct RunnerTab {
    app: Entity<AppState>,
    pub collection_id: String,
    pub folder_id: Option<String>,
    title: String,
    iterations: Entity<InputState>,
    delay: Entity<InputState>,
    data: Vec<Row>,
    data_file: Option<String>,
    bail: bool,
    excluded: HashSet<String>,
    requests: Vec<(String, String, String)>,
    running: Option<Arc<AtomicBool>>,
    total: usize,
    results: Vec<RunItemResult>,
    summary: Option<RunSummary>,
    expanded: HashSet<usize>,
    focus: FocusHandle,
}

impl EventEmitter<TabEvent> for RunnerTab {}

impl RunnerTab {
    pub fn new(
        app: Entity<AppState>,
        collection_id: String,
        folder_id: Option<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let iterations = cx.new(|cx| InputState::new(window, cx).default_value("1"));
        let delay = cx.new(|cx| InputState::new(window, cx).default_value("0"));
        let mut this = Self {
            app,
            collection_id,
            folder_id,
            title: String::new(),
            iterations,
            delay,
            data: vec![],
            data_file: None,
            bail: false,
            excluded: HashSet::new(),
            requests: vec![],
            running: None,
            total: 0,
            results: vec![],
            summary: None,
            expanded: HashSet::new(),
            focus: cx.focus_handle(),
        };
        this.load_requests(cx);
        this
    }

    fn load_requests(&mut self, cx: &mut Context<Self>) {
        let app = self.app.read(cx);
        let Some(c) = app.trees.get(&self.collection_id) else { return };
        let roots = match &self.folder_id {
            Some(f) => cartero_model::tree::find(&c.item, f).map(|f| (f.name.clone(), f.children().to_vec())),
            None => Some((c.info.name.clone(), c.item.clone())),
        };
        let Some((title, roots)) = roots else { return };
        self.title = title;
        self.requests = cartero_runner::run_requests(&roots)
            .into_iter()
            .map(|i| (i.id().to_string(), i.name.clone(), i.request.as_ref().map(|r| r.method.clone()).unwrap_or_default()))
            .collect();
    }

    pub fn title(&self) -> SharedString {
        trf("Runner · {name}", &[("name", &self.title)])
    }

    fn pick_data(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let rx = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some(tr("Fichero de datos (CSV o JSON)")),
        });
        cx.spawn_in(window, async move |this, cx| {
            if let Ok(Ok(Some(paths))) = rx.await
                && let Some(p) = paths.first()
            {
                let text = std::fs::read_to_string(p).unwrap_or_default();
                let path = p.to_string_lossy().to_string();
                let _ = this.update_in(cx, |this, window, cx| match cartero_runner::data::parse(&text) {
                    Ok(rows) => {
                        let n = rows.len().max(1).to_string();
                        this.data = rows;
                        this.data_file = Some(path);
                        this.iterations.update(cx, |s, cx| s.set_value(n, window, cx));
                        cx.notify();
                    }
                    Err(e) => window.push_notification(Notification::error(e.to_string()), cx),
                });
            }
        })
        .detach();
    }

    fn run(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.running.is_some() {
            return;
        }
        self.load_requests(cx);
        let iterations: u32 = self.iterations.read(cx).value().trim().parse().unwrap_or(1).clamp(1, 10_000);
        let delay: u64 = self.delay.read(cx).value().trim().parse().unwrap_or(0).min(60_000);
        let config = RunConfig {
            iterations,
            delay: std::time::Duration::from_millis(delay),
            data: self.data.clone(),
            bail: self.bail,
            folder: self.folder_id.clone(),
            exclude: self.excluded.iter().cloned().collect(),
        };
        let app = self.app.read(cx);
        let Some(collection) = app.trees.get(&self.collection_id).cloned() else { return };
        let mut ctx = app.run_context(Some(&self.collection_id), &cartero_model::Item::default());
        ctx.collection = collection;
        let before = ctx.vars.clone();
        let cancel = Arc::new(AtomicBool::new(false));
        self.running = Some(cancel.clone());
        self.results.clear();
        self.summary = None;
        self.expanded.clear();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let task = crate::runtime::spawn(async move {
            let mut ctx = ctx;
            let summary = cartero_runner::run_collection(&mut ctx, config, tx, cancel).await;
            (summary, ctx.vars)
        });
        cx.notify();
        cx.spawn_in(window, async move |this, cx| {
            while let Some(ev) = rx.recv().await {
                let stop = this
                    .update(cx, |this, cx| {
                        match ev {
                            RunEvent::Started { total, .. } => this.total = total,
                            RunEvent::ItemFinished(r) => this.results.push(*r),
                            RunEvent::ItemStarted { .. } | RunEvent::Finished(_) => {}
                        }
                        cx.notify();
                    })
                    .is_err();
                if stop {
                    return;
                }
            }
            let Ok((summary, after)) = task.await else { return };
            let _ = this.update_in(cx, |this, window, cx| {
                this.running = None;
                let cid = this.collection_id.clone();
                let json = serde_json::to_value(&summary).unwrap_or_default();
                this.app.update(cx, |a, cx| {
                    let ws = a.workspace.id.clone();
                    let _ = a.store.add_run(&ws, Some(&cid), &json);
                    a.persist_script_vars(&before, &after, Some(&cid), cx);
                    a.save_cookies();
                });
                let msg = trf(
                    "{p} tests superados, {f} fallidos",
                    &[("p", &summary.tests_passed.to_string()), ("f", &summary.tests_failed.to_string())],
                );
                if summary.tests_failed > 0 || summary.errors > 0 {
                    window.push_notification(Notification::warning(msg).title(tr("Ejecución terminada")), cx);
                } else {
                    window.push_notification(Notification::success(msg).title(tr("Ejecución terminada")), cx);
                }
                this.summary = Some(summary);
                cx.notify();
            });
        })
        .detach();
    }

    fn stop(&mut self, cx: &mut Context<Self>) {
        if let Some(c) = &self.running {
            c.store(true, Ordering::Relaxed);
        }
        cx.notify();
    }

    fn export(&mut self, junit: bool, window: &mut Window, cx: &mut Context<Self>) {
        let Some(s) = self.summary.clone() else { return };
        let (content, name) = if junit {
            (cartero_runner::report::junit(&s), "cartero-run.xml")
        } else {
            (cartero_runner::report::json(&s), "cartero-run.json")
        };
        let dir = dirs::download_dir().unwrap_or_else(std::env::temp_dir);
        let rx = cx.prompt_for_new_path(&dir, Some(name));
        cx.spawn_in(window, async move |_, cx| {
            if let Ok(Ok(Some(path))) = rx.await {
                let ok = std::fs::write(&path, content).is_ok();
                let _ = cx.update(|window, cx| {
                    if ok {
                        window.push_notification(Notification::success(tr("Informe guardado")), cx);
                    } else {
                        window.push_notification(Notification::error(tr("No se pudo guardar el fichero")), cx);
                    }
                });
            }
        })
        .detach();
    }
}

impl Focusable for RunnerTab {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl Render for RunnerTab {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let muted = cx.theme().muted_foreground;
        let border = cx.theme().border;
        let running = self.running.is_some();
        let label = |t: SharedString| div().text_xs().text_color(muted).child(t);
        let config = div()
            .v_flex()
            .w(px(320.))
            .h_full()
            .flex_none()
            .gap_3()
            .p_4()
            .border_r_1()
            .border_color(border)
            .child(div().text_lg().font_semibold().child(self.title.clone()))
            .child(div().v_flex().gap_1().child(label(tr("Iteraciones"))).child(Input::new(&self.iterations).small()))
            .child(div().v_flex().gap_1().child(label(tr("Retardo entre peticiones (ms)"))).child(Input::new(&self.delay).small()))
            .child(
                div().v_flex().gap_1().child(label(tr("Datos (una iteración por fila)"))).child(
                    div()
                        .h_flex()
                        .gap_2()
                        .child(
                            Button::new("pick-data")
                                .outline()
                                .small()
                                .icon(IconName::Upload)
                                .label(tr("CSV o JSON…"))
                                .on_click(cx.listener(|this, _, w, cx| this.pick_data(w, cx))),
                        )
                        .when_some(self.data_file.clone(), |d, f| {
                            let name = std::path::Path::new(&f).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or(f);
                            d.child(
                                div()
                                    .flex_1()
                                    .truncate()
                                    .text_xs()
                                    .child(trf("{file} · {n} filas", &[("file", &name), ("n", &self.data.len().to_string())])),
                            )
                            .child(Button::new("clear-data").ghost().xsmall().icon(IconName::X).on_click(
                                cx.listener(|this, _, _, cx| {
                                    this.data.clear();
                                    this.data_file = None;
                                    cx.notify();
                                }),
                            ))
                        }),
                ),
            )
            .child(Checkbox::new("bail").checked(self.bail).label(tr("Parar al primer fallo")).on_click(cx.listener(
                |this, c: &bool, _, cx| {
                    this.bail = *c;
                    cx.notify();
                },
            )))
            .child(if running {
                Button::new("stop-run")
                    .outline()
                    .icon(IconName::Square)
                    .label(tr("Parar"))
                    .on_click(cx.listener(|this, _, _, cx| this.stop(cx)))
            } else {
                Button::new("start-run")
                    .primary()
                    .icon(IconName::Play)
                    .label(tr("Ejecutar"))
                    .on_click(cx.listener(|this, _, w, cx| this.run(w, cx)))
            })
            .child(div().text_xs().font_semibold().pt_2().child(trf("Peticiones ({n})", &[("n", &self.requests.len().to_string())])))
            .child(div().id("runner-requests").flex_1().overflow_y_scroll().v_flex().gap_0p5().children(
                self.requests.iter().enumerate().map(|(i, (id, name, method))| {
                    let checked = !self.excluded.contains(id);
                    let id = id.clone();
                    div()
                        .h_flex()
                        .gap_2()
                        .text_sm()
                        .child(Checkbox::new(("run-req", i)).checked(checked).on_click(cx.listener(move |this, c: &bool, _, cx| {
                            if *c {
                                this.excluded.remove(&id);
                            } else {
                                this.excluded.insert(id.clone());
                            }
                            cx.notify();
                        })))
                        .child(method_label(method, cx))
                        .child(div().flex_1().truncate().child(name.clone()))
                }),
            ));

        let ok = crate::theme::status_color(200, cx);
        let bad = cx.theme().danger;
        let passed: usize = self.results.iter().map(|r| r.tests.iter().filter(|t| t.passed).count()).sum();
        let failed: usize = self.results.iter().map(|r| r.tests.iter().filter(|t| !t.passed).count()).sum();
        let progress = if self.total > 0 { self.results.len() as f32 / self.total as f32 } else { 0.0 };
        let results: AnyElement = if self.results.is_empty() && !running {
            empty_state(
                IconName::Rocket,
                tr("Ejecuta la colección"),
                tr("Las peticiones se envían en orden, con sus scripts y tests. Aquí verás el resultado de cada una."),
                cx,
            )
            .into_any_element()
        } else {
            let rows = self.results.iter().enumerate().map(|(i, r)| {
                let open = self.expanded.contains(&i);
                let t_ok = r.tests.iter().filter(|t| t.passed).count();
                let t_bad = r.tests.len() - t_ok;
                div()
                    .v_flex()
                    .border_b_1()
                    .border_color(border)
                    .child(
                        div()
                            .id(("run-row", i))
                            .h_flex()
                            .gap_3()
                            .px_3()
                            .py_1p5()
                            .text_sm()
                            .cursor_pointer()
                            .hover(|s| s.bg(cx.theme().muted))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                if !this.expanded.remove(&i) {
                                    this.expanded.insert(i);
                                }
                                cx.notify();
                            }))
                            .child(div().w(px(28.)).text_xs().text_color(muted).child(format!("#{}", r.iteration + 1)))
                            .child(method_label(&r.method, cx))
                            .child(div().flex_1().min_w_0().truncate().child(r.name.clone()))
                            .child(match r.status {
                                Some(s) => div().text_color(crate::theme::status_color(s, cx)).child(format!("{s} {}", r.reason)),
                                None if r.skipped => div().text_color(muted).child(tr("saltada")),
                                None => div().text_color(bad).child(tr("error")),
                            })
                            .child(div().w(px(70.)).text_right().text_color(muted).child(format!("{} ms", r.time_ms)))
                            .child(
                                div()
                                    .w(px(70.))
                                    .text_right()
                                    .when(t_bad > 0, |d| d.text_color(bad))
                                    .when(t_bad == 0 && t_ok > 0, |d| d.text_color(ok))
                                    .child(if r.tests.is_empty() { "—".to_string() } else { format!("{t_ok}/{}", r.tests.len()) }),
                            ),
                    )
                    .when(open, |d| {
                        d.child(
                            div()
                                .v_flex()
                                .gap_1()
                                .pl(px(70.))
                                .pr_3()
                                .pb_2()
                                .text_xs()
                                .child(div().text_color(muted).child(r.url.clone()))
                                .when_some(r.error.clone(), |d, e| d.child(div().text_color(bad).child(e)))
                                .children(r.tests.iter().map(|t| {
                                    div()
                                        .h_flex()
                                        .gap_2()
                                        .child(
                                            div().text_color(if t.passed { ok } else { bad }).child(
                                                Icon::new(if t.passed { IconName::CircleCheck } else { IconName::CircleX }).size_3(),
                                            ),
                                        )
                                        .child(t.name.clone())
                                        .when_some(t.error.clone().filter(|_| !t.passed), |d, e| d.child(div().text_color(bad).child(e)))
                                }))
                                .children(r.console.iter().map(|c| div().text_color(muted).child(format!("› {}", c.text)))),
                        )
                    })
            });
            div().id("run-results").size_full().overflow_y_scroll().v_flex().children(rows).into_any_element()
        };
        let header = div()
            .v_flex()
            .gap_2()
            .p_4()
            .border_b_1()
            .border_color(border)
            .child(
                div()
                    .h_flex()
                    .gap_4()
                    .text_sm()
                    .child(div().font_semibold().child(if running {
                        tr("Ejecutando…")
                    } else if self.summary.is_some() {
                        tr("Terminado")
                    } else {
                        tr("Resultados")
                    }))
                    .child(div().text_color(ok).child(trf("{n} superados", &[("n", &passed.to_string())])))
                    .child(div().text_color(if failed > 0 { bad } else { muted }).child(trf("{n} fallidos", &[("n", &failed.to_string())])))
                    .when_some(self.summary.as_ref(), |d, s| d.child(div().text_color(muted).child(format!("{} ms", s.duration_ms))))
                    .child(div().flex_1())
                    .when(self.summary.is_some(), |d| {
                        d.child(
                            Button::new("export-json")
                                .ghost()
                                .small()
                                .icon(IconName::Download)
                                .label("JSON")
                                .on_click(cx.listener(|this, _, w, cx| this.export(false, w, cx))),
                        )
                        .child(
                            Button::new("export-junit")
                                .ghost()
                                .small()
                                .icon(IconName::Download)
                                .label("JUnit")
                                .on_click(cx.listener(|this, _, w, cx| this.export(true, w, cx))),
                        )
                    }),
            )
            .child(
                div()
                    .h_1()
                    .w_full()
                    .rounded_full()
                    .bg(cx.theme().muted)
                    .child(div().h_full().rounded_full().bg(crate::theme::brand()).w(relative(progress))),
            );
        div()
            .track_focus(&self.focus)
            .size_full()
            .flex()
            .flex_row()
            .child(config)
            .child(div().flex_1().h_full().v_flex().child(header).child(div().flex_1().min_h_0().child(results)))
    }
}
