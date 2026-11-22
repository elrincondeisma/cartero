//! URL con `{{variables}}`: de texto a la forma estructurada de Postman y al revés.

use crate::types::{QueryParam, UrlParts, Variable};

/// Parsea una URL cruda (con posibles {{variables}}) al formato estructurado de Postman.
pub fn parse(raw: &str) -> UrlParts {
    let mut url = UrlParts { raw: raw.to_string(), ..Default::default() };
    let mut rest = raw.trim();

    if let Some(i) = rest.find('#') {
        url.hash = Some(rest[i + 1..].to_string());
        rest = &rest[..i];
    }
    let mut query: Option<&str> = None;
    if let Some(i) = rest.find('?') {
        query = Some(&rest[i + 1..]);
        rest = &rest[..i];
    }
    if let Some(i) = rest.find("://") {
        let proto = &rest[..i];
        if !proto.is_empty() && proto.chars().all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c)) {
            url.protocol = Some(proto.to_string());
            rest = &rest[i + 3..];
        }
    }
    // host[:port] hasta la primera '/' que no esté dentro de {{ }}
    let bytes = rest.as_bytes();
    let (mut depth, mut slash, mut i) = (0usize, None, 0);
    while i < bytes.len() {
        if rest[i..].starts_with("{{") {
            depth += 1;
            i += 2;
            continue;
        }
        if rest[i..].starts_with("}}") {
            depth = depth.saturating_sub(1);
            i += 2;
            continue;
        }
        if bytes[i] == b'/' && depth == 0 {
            slash = Some(i);
            break;
        }
        i += 1;
    }
    let (mut host, path) = match slash {
        Some(i) => (&rest[..i], Some(&rest[i + 1..])),
        None => (rest, None),
    };
    if !host.starts_with('[')
        && let Some(i) = host.rfind(':')
    {
        let port = &host[i + 1..];
        let is_var = port.starts_with("{{") && port.ends_with("}}");
        if is_var || (!port.is_empty() && port.chars().all(|c| c.is_ascii_digit())) {
            url.port = Some(port.to_string());
            host = &host[..i];
        }
    }
    if !host.is_empty() {
        url.host = Some(host.split('.').map(String::from).collect());
    }
    if let Some(p) = path {
        url.path = Some(p.split('/').map(String::from).collect());
    }
    if let Some(q) = query {
        url.query = Some(parse_query(q));
    }
    let vars: Vec<Variable> =
        url.path.iter().flatten().filter(|s| s.len() > 1 && s.starts_with(':')).map(|s| Variable::new(&s[1..], "")).collect();
    if !vars.is_empty() {
        url.variable = Some(vars);
    }
    url
}

pub fn parse_query(qs: &str) -> Vec<QueryParam> {
    if qs.is_empty() {
        return vec![];
    }
    qs.split('&')
        .map(|pair| match pair.split_once('=') {
            Some((k, v)) => QueryParam { key: Some(k.into()), value: Some(v.into()), ..Default::default() },
            None => QueryParam { key: Some(pair.into()), value: None, ..Default::default() },
        })
        .collect()
}

/// Reconstruye la URL a partir de su forma estructurada (sin los parámetros desactivados).
pub fn to_string(url: &UrlParts) -> String {
    if url.host.is_none() && url.path.is_none() && url.protocol.is_none() {
        return url.raw.clone();
    }
    let mut out = String::new();
    if let Some(p) = &url.protocol {
        out.push_str(p);
        out.push_str("://");
    }
    if let Some(h) = &url.host {
        out.push_str(&h.join("."));
    }
    if let Some(p) = &url.port {
        out.push(':');
        out.push_str(p);
    }
    if let Some(p) = &url.path {
        out.push('/');
        out.push_str(&p.join("/"));
    }
    let q = query_string(url.query.as_deref().unwrap_or_default());
    if !q.is_empty() {
        out.push('?');
        out.push_str(&q);
    }
    if let Some(h) = &url.hash {
        out.push('#');
        out.push_str(h);
    }
    out
}

pub fn query_string(params: &[QueryParam]) -> String {
    params
        .iter()
        .filter(|p| !p.disabled && p.key.is_some())
        .map(|p| match &p.value {
            Some(v) => format!("{}={v}", p.key.as_deref().unwrap_or_default()),
            None => p.key.clone().unwrap_or_default(),
        })
        .collect::<Vec<_>>()
        .join("&")
}

/// Cambia la URL cruda conservando las descripciones y el estado (activado/desactivado) de los
/// parámetros y variables de ruta que siguen existiendo, como hace la web al teclear.
pub fn set_raw(prev: &UrlParts, raw: &str) -> UrlParts {
    let mut next = parse(raw);
    // los parámetros desactivados no están en el texto: se conservan al final
    if let Some(q) = &mut next.query {
        for p in q.iter_mut() {
            if let Some(old) = prev.query.iter().flatten().find(|o| o.key == p.key && !o.disabled) {
                p.description = old.description.clone();
            }
        }
    }
    let disabled: Vec<QueryParam> = prev.query.iter().flatten().filter(|p| p.disabled).cloned().collect();
    if !disabled.is_empty() {
        next.query.get_or_insert_with(Vec::new).extend(disabled);
    }
    if let Some(vars) = &mut next.variable {
        for v in vars.iter_mut() {
            if let Some(old) = prev.variable.iter().flatten().find(|o| o.key == v.key) {
                *v = old.clone();
            }
        }
    }
    next
}

/// Cambia los parámetros y regenera la URL cruda.
pub fn set_query(prev: &UrlParts, query: Vec<QueryParam>) -> UrlParts {
    let base = prev.raw.split(['?', '#']).next().unwrap_or_default().to_string();
    let q = query_string(&query);
    let mut raw = base;
    if !q.is_empty() {
        raw.push('?');
        raw.push_str(&q);
    }
    if let Some(h) = &prev.hash {
        raw.push('#');
        raw.push_str(h);
    }
    let mut next = parse(&raw);
    next.query = if query.is_empty() { None } else { Some(query) };
    next.variable = prev.variable.clone().or(next.variable);
    next
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn variables_en_el_host_y_puerto() {
        let u = parse("{{baseUrl}}/users/:id?page=1&flag#top");
        assert_eq!(u.host, Some(vec!["{{baseUrl}}".into()]));
        assert_eq!(u.path, Some(vec!["users".into(), ":id".into()]));
        assert_eq!(u.query.as_ref().unwrap()[1].value, None);
        assert_eq!(u.hash.as_deref(), Some("top"));
        assert_eq!(u.variable.as_ref().unwrap()[0].key, "id");

        let u = parse("http://localhost:{{port}}/a");
        assert_eq!(u.port.as_deref(), Some("{{port}}"));
        assert_eq!(u.host, Some(vec!["localhost".into()]));
        let u = parse("https://api.example.com:8443/v1/x");
        assert_eq!(u.port.as_deref(), Some("8443"));
        assert_eq!(to_string(&u), "https://api.example.com:8443/v1/x");
    }

    #[test]
    fn parametros_desactivados_se_conservan() {
        let mut u = parse("https://x.io/a?a=1&b=2");
        u.query.as_mut().unwrap()[1].disabled = true;
        assert_eq!(to_string(&u), "https://x.io/a?a=1");
        let n = set_raw(&u, "https://x.io/a?a=3");
        let q = n.query.unwrap();
        assert_eq!(q.len(), 2);
        assert!(q[1].disabled && q[1].key.as_deref() == Some("b"));
    }
}
