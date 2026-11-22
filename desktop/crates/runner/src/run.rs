//! Runner de colecciones: recorre las peticiones en orden, con iteraciones, datos, retardo,
//! `setNextRequest`, parada al primer fallo y cancelación.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use cartero_model::{Item, tree};
use cartero_script::{NextRequest, TestResult};
use serde::Serialize;
use tokio::sync::mpsc::UnboundedSender;

use crate::{ConsoleEntry, ExecOptions, RunContext, data::Row, execute};

#[derive(Debug, Clone, Default)]
pub struct RunConfig {
    pub iterations: u32,
    pub delay: Duration,
    pub data: Vec<Row>,
    /// Para al primer test fallido o error
    pub bail: bool,
    /// Solo esta carpeta (por id); None = toda la colección
    pub folder: Option<String>,
    /// Peticiones desmarcadas en el runner (por id)
    pub exclude: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RunItemResult {
    pub iteration: u32,
    pub item_id: String,
    pub name: String,
    pub method: String,
    pub url: String,
    pub status: Option<u16>,
    pub reason: String,
    pub time_ms: u64,
    pub size: usize,
    pub tests: Vec<TestResult>,
    pub error: Option<String>,
    pub console: Vec<ConsoleEntry>,
    pub skipped: bool,
}

impl RunItemResult {
    pub fn passed(&self) -> bool {
        self.error.is_none() && self.tests.iter().all(|t| t.passed)
    }
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct RunSummary {
    pub collection: String,
    pub environment: String,
    pub started_at: String,
    pub duration_ms: u64,
    pub iterations: u32,
    pub results: Vec<RunItemResult>,
    pub requests: usize,
    pub tests_passed: usize,
    pub tests_failed: usize,
    pub errors: usize,
    pub cancelled: bool,
}

#[derive(Debug, Clone)]
pub enum RunEvent {
    Started { total: usize, iterations: u32 },
    ItemStarted { iteration: u32, item_id: String, name: String },
    ItemFinished(Box<RunItemResult>),
    Finished(Box<RunSummary>),
}

/// Peticiones de la colección (o de una carpeta) en el orden del árbol.
pub fn requests_in_order(items: &[Item]) -> Vec<Item> {
    let mut flat = vec![];
    tree::walk(items, &mut flat, 0);
    flat.into_iter().filter(|(i, _)| !i.is_folder()).map(|(i, _)| i.clone()).collect()
}

pub async fn run_collection(
    ctx: &mut RunContext,
    config: RunConfig,
    events: UnboundedSender<RunEvent>,
    cancel: Arc<AtomicBool>,
) -> RunSummary {
    let start = Instant::now();
    let roots: Vec<Item> = match &config.folder {
        Some(id) => tree::find(&ctx.collection.item, id).map(|f| f.children().to_vec()).unwrap_or_default(),
        None => ctx.collection.item.clone(),
    };
    let list: Vec<Item> = requests_in_order(&roots).into_iter().filter(|i| !config.exclude.iter().any(|x| x == i.id())).collect();
    let iterations = if config.data.is_empty() { config.iterations.max(1) } else { config.iterations.max(1).max(config.data.len() as u32) };
    let mut summary = RunSummary {
        collection: ctx.collection.info.name.clone(),
        environment: ctx.vars.environment_name.clone(),
        started_at: chrono::Utc::now().to_rfc3339(),
        iterations,
        ..Default::default()
    };
    let _ = events.send(RunEvent::Started { total: list.len() * iterations as usize, iterations });

    'run: for iteration in 0..iterations {
        ctx.vars.data =
            if config.data.is_empty() { Default::default() } else { config.data[iteration as usize % config.data.len()].clone() };
        ctx.vars.local.clear();
        let mut idx = 0;
        let mut steps = 0;
        while idx < list.len() {
            if cancel.load(Ordering::Relaxed) {
                summary.cancelled = true;
                break 'run;
            }
            // Protección contra bucles infinitos con setNextRequest
            steps += 1;
            if steps > list.len() * 50 + 1000 {
                break;
            }
            let item = &list[idx];
            let _ = events.send(RunEvent::ItemStarted { iteration, item_id: item.id().to_string(), name: item.name.clone() });
            let outcome = execute(ctx, item, &ExecOptions { iteration, iteration_count: iterations }).await;
            let mut tests = outcome.tests.clone();
            for e in &outcome.script_errors {
                tests.push(TestResult { name: e.clone(), passed: false, skipped: false, error: Some(e.clone()) });
            }
            let result = RunItemResult {
                iteration,
                item_id: item.id().to_string(),
                name: item.name.clone(),
                method: outcome.prepared.method.clone(),
                url: outcome.prepared.url.clone(),
                status: outcome.response.as_ref().map(|r| r.status),
                reason: outcome.response.as_ref().map(|r| r.reason.clone()).unwrap_or_default(),
                time_ms: outcome.response.as_ref().map(|r| r.timings.total.as_millis() as u64).unwrap_or(0),
                size: outcome.response.as_ref().map(|r| r.body_size + r.headers_size).unwrap_or(0),
                tests,
                error: outcome.error.clone(),
                console: outcome.console.clone(),
                skipped: outcome.skipped,
            };
            let failed = !result.passed();
            summary.requests += usize::from(!result.skipped);
            summary.tests_passed += result.tests.iter().filter(|t| t.passed && !t.skipped).count();
            summary.tests_failed += result.tests.iter().filter(|t| !t.passed).count();
            summary.errors += usize::from(result.error.is_some());
            summary.results.push(result.clone());
            let _ = events.send(RunEvent::ItemFinished(Box::new(result)));
            if failed && config.bail {
                break 'run;
            }
            idx = match outcome.next {
                NextRequest::Unchanged => idx + 1,
                NextRequest::Stop => break,
                NextRequest::Named(name) => match list.iter().position(|i| i.name == name || i.id() == name) {
                    Some(p) => p,
                    None => idx + 1,
                },
            };
            if !config.delay.is_zero() && idx < list.len() {
                tokio::time::sleep(config.delay).await;
            }
        }
    }
    summary.duration_ms = start.elapsed().as_millis() as u64;
    let _ = events.send(RunEvent::Finished(Box::new(summary.clone())));
    summary
}
