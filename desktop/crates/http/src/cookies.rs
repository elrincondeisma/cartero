//! Bote de cookies por workspace (RFC 6265): se envían y guardan solas, como en Postman.

use cookie_store::{CookieStore, RawCookie};
use serde::{Deserialize, Serialize};
use url::Url;

/// Una cookie tal y como se muestra en el gestor de cookies.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CookieInfo {
    pub domain: String,
    pub path: String,
    pub name: String,
    pub value: String,
    pub expires: Option<String>,
    pub http_only: bool,
    pub secure: bool,
    pub host_only: bool,
}

#[derive(Default)]
pub struct CookieJar {
    store: CookieStore,
}

impl std::fmt::Debug for CookieJar {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CookieJar").field("cookies", &self.list().len()).finish()
    }
}

impl CookieJar {
    pub fn new() -> Self {
        Self { store: CookieStore::new() }
    }

    /// Carga el bote guardado (JSON). Si no se puede leer, empieza vacío.
    pub fn from_json(json: &str) -> Self {
        let store = cookie_store::serde::json::load_all(json.as_bytes()).unwrap_or_default();
        Self { store }
    }

    pub fn to_json(&self) -> String {
        let mut out = Vec::new();
        let _ = cookie_store::serde::json::save_incl_expired_and_nonpersistent(&self.store, &mut out);
        String::from_utf8(out).unwrap_or_default()
    }

    /// Valor de la cabecera Cookie para una URL, si hay cookies que enviar.
    pub fn header_for(&self, url: &Url) -> Option<String> {
        let parts: Vec<String> = self.store.get_request_values(url).map(|(k, v)| format!("{k}={v}")).collect();
        (!parts.is_empty()).then(|| parts.join("; "))
    }

    /// Guarda las cookies de las cabeceras Set-Cookie de una respuesta.
    pub fn store_from_headers(&mut self, url: &Url, headers: &[(String, String)]) {
        let cookies = headers
            .iter()
            .filter(|(k, _)| k.eq_ignore_ascii_case("set-cookie"))
            .filter_map(|(_, v)| RawCookie::parse(v.clone()).ok())
            .map(|c| c.into_owned());
        self.store.store_response_cookies(cookies, url);
    }

    pub fn list(&self) -> Vec<CookieInfo> {
        let mut out: Vec<CookieInfo> = self
            .store
            .iter_unexpired()
            .map(|c| CookieInfo {
                domain: String::from(&c.domain).trim_start_matches('.').to_string(),
                path: String::from(&c.path),
                name: c.name().to_string(),
                value: c.value().to_string(),
                expires: match &c.expires {
                    cookie_store::CookieExpiration::AtUtc(t) => Some(t.to_string()),
                    _ => None,
                },
                http_only: c.http_only().unwrap_or(false),
                secure: c.secure().unwrap_or(false),
                host_only: matches!(c.domain, cookie_store::CookieDomain::HostOnly(_)),
            })
            .collect();
        out.sort_by(|a, b| (&a.domain, &a.name).cmp(&(&b.domain, &b.name)));
        out
    }

    pub fn remove(&mut self, domain: &str, path: &str, name: &str) {
        if self.store.remove(domain, path, name).is_none() {
            self.store.remove(&format!(".{domain}"), path, name);
        }
    }

    pub fn clear_domain(&mut self, domain: &str) {
        let doomed: Vec<(String, String, String)> =
            self.list().into_iter().filter(|c| c.domain == domain).map(|c| (c.domain, c.path, c.name)).collect();
        for (d, p, n) in doomed {
            self.remove(&d, &p, &n);
        }
    }

    pub fn clear(&mut self) {
        self.store.clear();
    }

    /// Añade o cambia una cookie a mano (gestor de cookies o `pm.cookies.jar().set`).
    pub fn set(&mut self, url: &Url, set_cookie: &str) -> bool {
        self.store.parse(set_cookie, url).is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guarda_envia_y_persiste() {
        let mut jar = CookieJar::new();
        let url = Url::parse("https://api.example.com/login").unwrap();
        jar.store_from_headers(
            &url,
            &[
                ("Set-Cookie".into(), "sid=abc; Path=/; HttpOnly".into()),
                ("set-cookie".into(), "theme=dark; Domain=example.com; Path=/".into()),
            ],
        );
        let other = Url::parse("https://api.example.com/users").unwrap();
        let header = jar.header_for(&other).unwrap();
        assert!(header.contains("sid=abc") && header.contains("theme=dark"), "{header}");
        assert_eq!(jar.header_for(&Url::parse("https://www.example.com/").unwrap()).as_deref(), Some("theme=dark"));
        let back = CookieJar::from_json(&jar.to_json());
        assert_eq!(back.list().len(), 2);
        let mut back = back;
        back.remove("api.example.com", "/", "sid");
        assert_eq!(back.list().len(), 1);
        assert!(back.set(&url, "manual=1; Path=/"));
        assert_eq!(back.list().len(), 2);
    }
}
