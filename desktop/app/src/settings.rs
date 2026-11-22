//! Ajustes de la app (Ajustes → General, Proxy, Certificados). Se guardan en SQLite.

use std::time::Duration;

use cartero_http::{ClientCert, Options, Proxy};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ThemeChoice {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    #[default]
    System,
    Es,
    En,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct CertEntry {
    pub host: String,
    pub cert_path: String,
    pub key_path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub theme: ThemeChoice,
    pub language: Language,
    pub timeout_ms: u64,
    pub follow_redirects: bool,
    pub max_redirects: u32,
    pub verify_tls: bool,
    pub proxy_enabled: bool,
    pub proxy_url: String,
    pub proxy_bypass: String,
    pub client_certs: Vec<CertEntry>,
    pub ca_path: String,
    /// Guardar los cambios que hacen los scripts en entornos y globales
    pub persist_script_variables: bool,
    pub script_timeout_s: u64,
    /// Tamaño a partir del cual la respuesta se muestra sin resaltado
    pub highlight_limit_kb: u64,
    pub check_updates: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: ThemeChoice::System,
            language: Language::System,
            timeout_ms: 60_000,
            follow_redirects: true,
            max_redirects: 10,
            verify_tls: true,
            proxy_enabled: false,
            proxy_url: String::new(),
            proxy_bypass: "localhost, 127.0.0.1".into(),
            client_certs: vec![],
            ca_path: String::new(),
            persist_script_variables: true,
            script_timeout_s: 30,
            highlight_limit_kb: 2048,
            check_updates: true,
        }
    }
}

impl Settings {
    /// Opciones del motor HTTP. Los certificados se leen del disco en cada envío.
    pub fn http_options(&self) -> Options {
        let client_certs = self
            .client_certs
            .iter()
            .filter_map(|c| {
                Some(ClientCert {
                    host: c.host.clone(),
                    cert_pem: std::fs::read(&c.cert_path).ok()?,
                    key_pem: std::fs::read(&c.key_path).ok()?,
                })
            })
            .collect();
        Options {
            timeout: Duration::from_millis(self.timeout_ms.max(100)),
            follow_redirects: self.follow_redirects,
            max_redirects: self.max_redirects,
            verify_tls: self.verify_tls,
            proxy: (self.proxy_enabled && !self.proxy_url.trim().is_empty()).then(|| Proxy {
                url: self.proxy_url.trim().to_string(),
                bypass: self.proxy_bypass.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
            }),
            client_certs,
            ca_pem: (!self.ca_path.trim().is_empty()).then(|| std::fs::read(self.ca_path.trim()).ok()).flatten(),
            decompress: true,
        }
    }

    pub fn english(&self) -> bool {
        match self.language {
            Language::System => crate::i18n::system_prefers_english(),
            Language::Es => false,
            Language::En => true,
        }
    }
}
