//! Idiomas: el texto en español es la clave (igual que en la web) y la traducción inglesa está
//! en `en.json`. `tr("Guardar")` devuelve el texto en el idioma activo.

use std::collections::HashMap;
use std::sync::LazyLock;
use std::sync::atomic::{AtomicBool, Ordering};

use gpui_kit::SharedString;

static ENGLISH: AtomicBool = AtomicBool::new(false);

static EN: LazyLock<HashMap<String, String>> =
    LazyLock::new(|| serde_json::from_str(include_str!("i18n/en.json")).expect("en.json válido"));

pub fn set_english(on: bool) {
    ENGLISH.store(on, Ordering::Relaxed);
}

pub fn is_english() -> bool {
    ENGLISH.load(Ordering::Relaxed)
}

/// Idioma del sistema: inglés salvo que el sistema esté en español.
pub fn system_prefers_english() -> bool {
    let lang = std::env::var("LC_ALL").or_else(|_| std::env::var("LC_MESSAGES")).or_else(|_| std::env::var("LANG")).unwrap_or_default();
    if lang.is_empty() {
        return false;
    }
    !lang.to_lowercase().starts_with("es")
}

pub fn tr(es: &'static str) -> SharedString {
    let text: SharedString = match EN.get(es).filter(|_| is_english()) {
        Some(en) => en.clone().into(),
        None => SharedString::new_static(es),
    };
    // En macOS los atajos van con ⌘
    if cfg!(target_os = "macos") && text.contains("Ctrl+") {
        return text.replace("Ctrl+", "⌘").into();
    }
    text
}

/// Con sustituciones: `trf("Hace {n} min", &[("n", "5")])`.
pub fn trf(es: &'static str, args: &[(&str, &str)]) -> SharedString {
    let mut s = tr(es).to_string();
    for (k, v) in args {
        s = s.replace(&format!("{{{k}}}"), v);
    }
    s.into()
}

#[cfg(test)]
mod tests {
    #[test]
    fn en_json_valido() {
        assert!(super::EN.len() > 300);
        super::set_english(true);
        assert_eq!(super::tr("Guardar").as_ref(), "Save");
        super::set_english(false);
    }

    /// Todas las cadenas de tr("…") y trf("…") del código tienen traducción inglesa.
    #[test]
    fn no_faltan_traducciones() {
        let en: std::collections::HashMap<String, String> = serde_json::from_str(include_str!("i18n/en.json")).unwrap();
        let mut missing = vec![];
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/src");
        let mut stack = vec![std::path::PathBuf::from(dir)];
        while let Some(p) = stack.pop() {
            for entry in std::fs::read_dir(&p).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                    continue;
                }
                if path.extension().is_none_or(|e| e != "rs") {
                    continue;
                }
                let src = std::fs::read_to_string(&path).unwrap();
                for marker in ["tr(\"", "trf(\""] {
                    let mut rest = src.as_str();
                    while let Some(i) = rest.find(marker) {
                        let after = &rest[i + marker.len()..];
                        let mut end = 0;
                        let bytes = after.as_bytes();
                        while end < bytes.len() && !(bytes[end] == b'"' && (end == 0 || bytes[end - 1] != b'\\')) {
                            end += 1;
                        }
                        let key = after[..end].replace("\\\"", "\"").replace("\\n", "\n");
                        let prev = rest[..i].chars().last().unwrap_or(' ');
                        if !prev.is_alphanumeric() && prev != '_' && !en.contains_key(&key) && key != "…" {
                            missing.push(format!("{}: {key}", path.file_name().unwrap().to_string_lossy()));
                        }
                        rest = &after[end..];
                    }
                }
            }
        }
        missing.sort();
        missing.dedup();
        assert!(missing.is_empty(), "Faltan {} traducciones:\n{}", missing.len(), missing.join("\n"));
    }
}
