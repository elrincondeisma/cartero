//! `{{variables}}`: resolución por capas (como Postman) y variables dinámicas (`{{$guid}}`…).

use std::collections::HashMap;

use rand::Rng;

use crate::types::Variable;

pub type Scope = HashMap<String, String>;

/// Lista de variables a mapa, sin las desactivadas.
pub fn to_scope(vars: &[Variable]) -> Scope {
    vars.iter().filter(|v| !v.disabled && !v.key.is_empty()).map(|v| (v.key.clone(), v.value_str())).collect()
}

/// Capas de variables de menor a mayor prioridad: globales → colección → entorno → datos → locales.
#[derive(Debug, Clone, Default)]
pub struct Layers {
    pub layers: Vec<Scope>,
}

impl Layers {
    pub fn new(layers: Vec<Scope>) -> Self {
        Self { layers }
    }
    pub fn get(&self, key: &str) -> Option<&String> {
        self.layers.iter().rev().find_map(|l| l.get(key))
    }
    /// Qué capa define la variable (índice), para mostrar de dónde sale su valor.
    pub fn source(&self, key: &str) -> Option<usize> {
        self.layers.iter().rposition(|l| l.contains_key(key))
    }

    /// Resuelve {{variables}} en un texto, también anidadas, hasta 10 niveles.
    pub fn resolve(&self, text: &str) -> String {
        let mut out = text.to_string();
        for _ in 0..10 {
            let next = replace_vars(&out, |name| {
                if let Some(v) = self.get(name) {
                    return Some(v.clone());
                }
                dynamic(name)
            });
            if next == out {
                break;
            }
            out = next;
        }
        out
    }
}

/// Sustituye cada `{{nombre}}` por lo que devuelva `f`; si devuelve None, lo deja como está.
pub fn replace_vars(text: &str, mut f: impl FnMut(&str) -> Option<String>) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        match after.find("}}") {
            Some(end) if !after[..end].contains("{{") && !after[..end].is_empty() => {
                let name = after[..end].trim();
                match f(name) {
                    Some(v) => out.push_str(&v),
                    None => out.push_str(&rest[start..start + 2 + end + 2]),
                }
                rest = &after[end + 2..];
            }
            _ => {
                out.push_str("{{");
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Nombres de las {{variables}} usadas en un texto, en orden y sin repetir.
pub fn names(text: &str) -> Vec<String> {
    let mut found = Vec::new();
    replace_vars(text, |n| {
        if !found.iter().any(|f: &String| f == n) {
            found.push(n.to_string());
        }
        None
    });
    found
}

/// Posiciones (en bytes) de cada `{{variable}}` en el texto, para resaltarlas.
pub fn spans(text: &str) -> Vec<(std::ops::Range<usize>, String)> {
    let mut out = vec![];
    let mut offset = 0;
    let mut rest = text;
    while let Some(start) = rest.find("{{") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else { break };
        if after[..end].contains("{{") {
            offset += start + 2;
            rest = after;
            continue;
        }
        let s = offset + start;
        let e = s + 2 + end + 2;
        out.push((s..e, after[..end].trim().to_string()));
        offset = e;
        rest = &after[end + 2..];
    }
    out
}

const FIRST: &[&str] = &["Ana", "Luis", "María", "Carlos", "Lucía", "Javier", "Elena", "Pablo", "Sara", "Diego"];
const LAST: &[&str] = &["García", "López", "Martínez", "Sánchez", "Pérez", "Gómez", "Ruiz", "Díaz", "Moreno", "Álvarez"];
const WORDS: &[&str] = &["alpha", "bravo", "cartero", "delta", "echo", "foxtrot", "golf", "hotel", "india", "kilo"];

/// Variables dinámicas de Postman más usadas.
pub fn dynamic(name: &str) -> Option<String> {
    let mut rng = rand::rng();
    let pick = |list: &[&str], rng: &mut rand::rngs::ThreadRng| list[rng.random_range(0..list.len())].to_string();
    Some(match name {
        "$guid" | "$randomUUID" => uuid::Uuid::new_v4().to_string(),
        "$timestamp" => chrono::Utc::now().timestamp().to_string(),
        "$isoTimestamp" => chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "$randomInt" => rng.random_range(0..=1000).to_string(),
        "$randomBoolean" => rng.random_bool(0.5).to_string(),
        "$randomFirstName" => pick(FIRST, &mut rng),
        "$randomLastName" => pick(LAST, &mut rng),
        "$randomFullName" => format!("{} {}", pick(FIRST, &mut rng), pick(LAST, &mut rng)),
        "$randomUserName" => format!("{}{}", pick(WORDS, &mut rng), rng.random_range(10..999)),
        "$randomEmail" | "$randomExampleEmail" => format!("{}{}@example.com", pick(WORDS, &mut rng), rng.random_range(10..999)),
        "$randomWord" => pick(WORDS, &mut rng),
        "$randomColor" => pick(&["red", "green", "blue", "orange", "purple", "black", "white"], &mut rng),
        "$randomHexColor" => format!("#{:06x}", rng.random_range(0..0xffffff)),
        "$randomIP" => format!("{}.{}.{}.{}", rng.random_range(1..255), rng.random::<u8>(), rng.random::<u8>(), rng.random_range(1..255)),
        "$randomPhoneNumber" => format!("6{:08}", rng.random_range(0..100_000_000)),
        "$randomAlphaNumeric" => {
            let c = b"abcdefghijklmnopqrstuvwxyz0123456789";
            (c[rng.random_range(0..c.len())] as char).to_string()
        }
        "$randomPrice" => format!("{:.2}", rng.random_range(1.0..1000.0)),
        "$randomCity" => pick(&["Madrid", "Barcelona", "Valencia", "Sevilla", "Bilbao", "Málaga"], &mut rng),
        "$randomCountry" => pick(&["España", "Portugal", "Francia", "Italia", "México", "Argentina"], &mut rng),
        "$randomUrl" => format!("https://{}.example.com", pick(WORDS, &mut rng)),
        "$randomLoremWord" => pick(&["lorem", "ipsum", "dolor", "sit", "amet"], &mut rng),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope(pairs: &[(&str, &str)]) -> Scope {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn prioridad_y_anidadas() {
        let l = Layers::new(vec![scope(&[("host", "global"), ("v", "1")]), scope(&[("host", "{{proto}}://env"), ("proto", "https")])]);
        assert_eq!(l.resolve("{{host}}/x/{{v}}/{{nope}}"), "https://env/x/1/{{nope}}");
        assert_eq!(l.source("v"), Some(0));
        assert_eq!(l.source("host"), Some(1));
        assert_eq!(l.resolve("{{$guid}}").len(), 36);
    }

    #[test]
    fn nombres_y_posiciones() {
        assert_eq!(names("{{a}} y {{ b }} y {{a}}"), vec!["a", "b"]);
        let s = spans("x{{a}}y{{b}}");
        assert_eq!(s[0].0, 1..6);
        assert_eq!(s[1].1, "b");
        assert_eq!(replace_vars("{{ {{a}}", |_| Some("1".into())), "{{ 1");
    }
}
