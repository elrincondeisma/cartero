//! Runtime de tokio para la red y los scripts. GPUI tiene su propio ejecutor; las tareas de
//! tokio se esperan desde GPUI con su `JoinHandle`, que es un futuro normal.

use std::future::Future;
use std::sync::LazyLock;

static RUNTIME: LazyLock<tokio::runtime::Runtime> = LazyLock::new(|| {
    tokio::runtime::Builder::new_multi_thread().worker_threads(4).enable_all().thread_name("cartero-red").build().expect("runtime de tokio")
});

pub fn spawn<F>(fut: F) -> tokio::task::JoinHandle<F::Output>
where
    F: Future + Send + 'static,
    F::Output: Send + 'static,
{
    RUNTIME.spawn(fut)
}
