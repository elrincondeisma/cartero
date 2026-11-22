//! Operaciones sobre el árbol de carpetas y peticiones.

use crate::types::{Auth, Collection, Item};

/// Recorre todos los ítems en profundidad, con su nivel.
pub fn walk<'a>(items: &'a [Item], out: &mut Vec<(&'a Item, usize)>, depth: usize) {
    for i in items {
        out.push((i, depth));
        walk(i.children(), out, depth + 1);
    }
}

pub fn find<'a>(items: &'a [Item], id: &str) -> Option<&'a Item> {
    for i in items {
        if i.id() == id {
            return Some(i);
        }
        if let Some(f) = find(i.children(), id) {
            return Some(f);
        }
    }
    None
}

pub fn find_mut<'a>(items: &'a mut [Item], id: &str) -> Option<&'a mut Item> {
    for i in items.iter_mut() {
        if i.id() == id {
            return Some(i);
        }
        if let Some(children) = i.item.as_deref_mut()
            && let Some(f) = find_mut(children, id)
        {
            return Some(f);
        }
    }
    None
}

/// Carpetas que contienen el ítem, de la raíz hacia abajo.
pub fn ancestors<'a>(items: &'a [Item], id: &str) -> Option<Vec<&'a Item>> {
    for i in items {
        if i.id() == id {
            return Some(vec![]);
        }
        if let Some(mut path) = ancestors(i.children(), id) {
            path.insert(0, i);
            return Some(path);
        }
    }
    None
}

/// Quita un ítem del árbol y lo devuelve.
pub fn remove(items: &mut Vec<Item>, id: &str) -> Option<Item> {
    if let Some(pos) = items.iter().position(|i| i.id() == id) {
        return Some(items.remove(pos));
    }
    for i in items.iter_mut() {
        if let Some(children) = i.item.as_mut()
            && let Some(found) = remove(children, id)
        {
            return Some(found);
        }
    }
    None
}

/// Inserta un ítem dentro de una carpeta (o en la raíz si `parent` es None) en la posición dada.
pub fn insert(items: &mut Vec<Item>, parent: Option<&str>, index: usize, item: Item) -> bool {
    let list = match parent {
        None => items,
        Some(pid) => match find_mut(items, pid) {
            Some(p) if p.is_folder() => p.item.get_or_insert_with(Vec::new),
            _ => return false,
        },
    };
    let index = index.min(list.len());
    list.insert(index, item);
    true
}

/// ¿`id` está dentro de `ancestor` (o es él)? Para no mover una carpeta dentro de sí misma.
pub fn is_within(items: &[Item], id: &str, ancestor: &str) -> bool {
    id == ancestor || find(items, ancestor).is_some_and(|a| find(a.children(), id).is_some())
}

/// Mueve un ítem a otra carpeta o posición.
pub fn move_item(items: &mut Vec<Item>, id: &str, parent: Option<&str>, index: usize) -> bool {
    if parent.is_some_and(|p| is_within(items, p, id)) {
        return false;
    }
    let Some(item) = remove(items, id) else { return false };
    insert(items, parent, index, item)
}

/// Copia un ítem con ids nuevos (también sus hijos y ejemplos).
pub fn duplicate(item: &Item) -> Item {
    let mut copy = item.clone();
    fn renew(i: &mut Item) {
        i.id = Some(crate::new_id());
        for r in i.response.iter_mut().flatten() {
            r.id = Some(crate::new_id());
        }
        for c in i.item.iter_mut().flatten() {
            renew(c);
        }
    }
    renew(&mut copy);
    copy
}

/// La autenticación que se aplica de verdad a una petición: la suya, o la de la carpeta más
/// cercana, o la de la colección. Devuelve también de dónde sale (nombre de la carpeta o colección).
pub fn effective_auth<'a>(collection: &'a Collection, item_id: &str) -> Option<(&'a Auth, String)> {
    let item = find(&collection.item, item_id)?;
    if let Some(r) = &item.request {
        match &r.auth {
            Some(Some(a)) if !a.is_inherit() => return Some((a, item.name.clone())).filter(|(a, _)| !a.is_none()),
            Some(None) => return None,
            _ => {}
        }
    }
    let path = ancestors(&collection.item, item_id)?;
    for folder in path.iter().rev() {
        match &folder.auth {
            Some(Some(a)) if !a.is_inherit() => return Some((a, folder.name.clone())).filter(|(a, _)| !a.is_none()),
            Some(None) => return None,
            _ => {}
        }
    }
    collection.auth().filter(|a| !a.is_inherit() && !a.is_none()).map(|a| (a, collection.info.name.clone()))
}

/// Asigna ids a los ítems y ejemplos que no tengan.
pub fn ensure_ids(c: &mut Collection) {
    if c.info.postman_id.is_none() {
        c.info.postman_id = Some(crate::new_id());
    }
    fn go(items: &mut [Item]) {
        for i in items {
            if i.id.as_deref().is_none_or(str::is_empty) {
                i.id = Some(crate::new_id());
            }
            for r in i.response.iter_mut().flatten() {
                if r.id.is_none() {
                    r.id = Some(crate::new_id());
                }
            }
            if let Some(children) = i.item.as_deref_mut() {
                go(children);
            }
        }
    }
    go(&mut c.item);
}

pub fn count_requests(items: &[Item]) -> usize {
    items.iter().map(|i| if i.is_folder() { count_requests(i.children()) } else { 1 }).sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Request;

    fn sample() -> Collection {
        let mut c = Collection::new("C");
        let mut f = Item::folder("F");
        f.id = Some("f".into());
        let mut r = Item::request("R", Request::new("GET", "https://x.io"));
        r.id = Some("r".into());
        f.item = Some(vec![r]);
        let mut r2 = Item::request("R2", Request::new("GET", "https://x.io"));
        r2.id = Some("r2".into());
        c.item = vec![f, r2];
        c
    }

    #[test]
    fn mover_y_no_dentro_de_si_misma() {
        let mut c = sample();
        assert!(move_item(&mut c.item, "r2", Some("f"), 0));
        assert_eq!(find(&c.item, "f").unwrap().children()[0].name, "R2");
        assert!(!move_item(&mut c.item, "f", Some("f"), 0));
        assert_eq!(ancestors(&c.item, "r").unwrap()[0].name, "F");
    }

    #[test]
    fn herencia_de_auth() {
        let mut c = sample();
        let mut a = Auth::new("bearer");
        a.set("token", "t");
        c.auth = Some(Some(a));
        assert_eq!(effective_auth(&c, "r").unwrap().1, "C");
        let mut b = Auth::new("basic");
        b.set("username", "u");
        find_mut(&mut c.item, "f").unwrap().auth = Some(Some(b));
        let (auth, from) = effective_auth(&c, "r").unwrap();
        assert_eq!((auth.kind.as_str(), from.as_str()), ("basic", "F"));
        find_mut(&mut c.item, "r").unwrap().request.as_mut().unwrap().auth = Some(Some(Auth::new("noauth")));
        assert!(effective_auth(&c, "r").is_none());
    }
}
