//! Comprueba si hay una versión nueva de la app en las releases de GitHub.

use cartero_model::prepare::Prepared;
use gpui_kit::component::notification::Notification;

use crate::state::AppState;
use crate::ui::prelude::*;

const RELEASES_API: &str = "https://api.github.com/repos/elrincondeisma/cartero/releases?per_page=20";
pub const RELEASES_PAGE: &str = "https://github.com/elrincondeisma/cartero/releases";

fn parse_version(s: &str) -> Option<(u64, u64, u64)> {
    let v = s.trim().trim_start_matches("desktop-").trim_start_matches('v');
    let mut parts = v.split(['.', '-']).map(|p| p.parse::<u64>().ok());
    Some((parts.next()??, parts.next()??, parts.next().flatten().unwrap_or(0)))
}

/// La versión más alta publicada para el escritorio (etiquetas `desktop-vX.Y.Z`), si es más nueva.
pub async fn latest_newer(opts: cartero_http::Options) -> Result<Option<(String, String)>, String> {
    let p = Prepared {
        method: "GET".into(),
        url: RELEASES_API.into(),
        headers: vec![("User-Agent".into(), "Cartero-Desktop".into()), ("Accept".into(), "application/vnd.github+json".into())],
        ..Default::default()
    };
    let res = cartero_http::send(&p, &opts, None).await.map_err(|e| e.to_string())?;
    if res.status != 200 {
        return Err(format!("GitHub respondió {}", res.status));
    }
    let list: serde_json::Value = serde_json::from_slice(&res.body).map_err(|e| e.to_string())?;
    let current = parse_version(env!("CARGO_PKG_VERSION")).unwrap_or_default();
    let best = list
        .as_array()
        .into_iter()
        .flatten()
        .filter(|r| r["draft"] != true && r["prerelease"] != true)
        .filter_map(|r| {
            let tag = r["tag_name"].as_str()?;
            if !tag.starts_with("desktop-") {
                return None;
            }
            Some((parse_version(tag)?, tag.to_string(), r["html_url"].as_str().unwrap_or(RELEASES_PAGE).to_string()))
        })
        .max_by_key(|(v, _, _)| *v);
    Ok(best.filter(|(v, _, _)| *v > current).map(|(_, tag, url)| (tag, url)))
}

pub fn check_now(app: Entity<AppState>, manual: bool, window: &mut Window, cx: &mut App) {
    let opts = app.read(cx).settings.http_options();
    let task = crate::runtime::spawn(latest_newer(opts));
    window
        .spawn(cx, async move |cx| {
            let result = task.await.unwrap_or_else(|e| Err(e.to_string()));
            let _ = cx.update(|window, cx| match result {
                Ok(Some((tag, url))) => {
                    let version = tag.trim_start_matches("desktop-").to_string();
                    window.push_notification(
                        Notification::info(trf("Hay una versión nueva de Cartero ({v}).", &[("v", &version)]))
                            .title(tr("Actualización disponible"))
                            .autohide(false)
                            .on_click(move |_, _, _| {
                                let _ = open::that(&url);
                            }),
                        cx,
                    );
                }
                Ok(None) if manual => window.push_notification(Notification::success(tr("Ya tienes la última versión")), cx),
                Err(e) if manual => window.push_notification(Notification::error(e).title(tr("No se pudo comprobar")), cx),
                _ => {}
            });
        })
        .detach();
}

#[cfg(test)]
mod tests {
    use super::parse_version;

    #[test]
    fn versiones() {
        assert_eq!(parse_version("desktop-v1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_version("v0.10"), Some((0, 10, 0)));
        assert!(parse_version("desktop-v1.2.3") > parse_version("0.9.9"));
        assert_eq!(parse_version("latest"), None);
    }
}
