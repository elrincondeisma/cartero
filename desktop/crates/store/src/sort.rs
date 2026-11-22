//! Claves de orden fraccional, idénticas a las de `fractional-indexing` que usa el servidor:
//! insertar entre dos elementos no obliga a renumerar a los demás.

const DIGITS: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ZERO: u8 = b'0';

fn idx(c: u8) -> usize {
    DIGITS.iter().position(|&d| d == c).expect("dígito base62")
}

fn midpoint(a: &[u8], b: Option<&[u8]>) -> Vec<u8> {
    if let Some(b) = b {
        let mut n = 0;
        while n < b.len() && a.get(n).copied().unwrap_or(ZERO) == b[n] {
            n += 1;
        }
        if n > 0 {
            let mut out = b[..n].to_vec();
            out.extend(midpoint(a.get(n..).unwrap_or_default(), Some(&b[n..])));
            return out;
        }
    }
    let da = a.first().map(|&c| idx(c)).unwrap_or(0);
    let db = b.map(|b| idx(b[0])).unwrap_or(DIGITS.len());
    if db - da > 1 {
        vec![DIGITS[(da + db).div_ceil(2)]]
    } else if let Some(b) = b.filter(|b| b.len() > 1) {
        vec![b[0]]
    } else {
        let mut out = vec![DIGITS[da]];
        out.extend(midpoint(a.get(1..).unwrap_or_default(), None));
        out
    }
}

fn integer_len(head: u8) -> usize {
    match head {
        b'a'..=b'z' => (head - b'a') as usize + 2,
        b'A'..=b'Z' => (b'Z' - head) as usize + 2,
        _ => 2,
    }
}

fn integer_part(key: &[u8]) -> &[u8] {
    &key[..integer_len(key[0]).min(key.len())]
}

fn increment(x: &[u8]) -> Option<Vec<u8>> {
    let head = x[0];
    let mut digs = x[1..].to_vec();
    let mut carry = true;
    for d in digs.iter_mut().rev() {
        let n = idx(*d) + 1;
        if n == DIGITS.len() {
            *d = ZERO;
        } else {
            *d = DIGITS[n];
            carry = false;
            break;
        }
    }
    if !carry {
        let mut out = vec![head];
        out.extend(digs);
        return Some(out);
    }
    match head {
        b'Z' => Some(vec![b'a', ZERO]),
        b'z' => None,
        _ => {
            let h = head + 1;
            if h > b'a' {
                digs.push(ZERO);
            } else {
                digs.pop();
            }
            let mut out = vec![h];
            out.extend(digs);
            Some(out)
        }
    }
}

fn decrement(x: &[u8]) -> Option<Vec<u8>> {
    let head = x[0];
    let mut digs = x[1..].to_vec();
    let last = *DIGITS.last().unwrap();
    let mut borrow = true;
    for d in digs.iter_mut().rev() {
        let n = idx(*d);
        if n == 0 {
            *d = last;
        } else {
            *d = DIGITS[n - 1];
            borrow = false;
            break;
        }
    }
    if !borrow {
        let mut out = vec![head];
        out.extend(digs);
        return Some(out);
    }
    match head {
        b'a' => Some(vec![b'Z', last]),
        b'A' => None,
        _ => {
            let h = head - 1;
            if h < b'Z' {
                digs.push(last);
            } else {
                digs.pop();
            }
            let mut out = vec![h];
            out.extend(digs);
            Some(out)
        }
    }
}

/// Clave entre `a` y `b` (cualquiera de las dos puede faltar).
pub fn key_between(a: Option<&str>, b: Option<&str>) -> String {
    let (a, b) = (a.map(str::as_bytes), b.map(str::as_bytes));
    let out = match (a, b) {
        (None, None) => vec![b'a', ZERO],
        (None, Some(b)) => {
            let ib = integer_part(b);
            let fb = &b[ib.len()..];
            let smallest: Vec<u8> = std::iter::once(b'A').chain(std::iter::repeat_n(ZERO, 26)).collect();
            if ib == smallest.as_slice() {
                let mut o = ib.to_vec();
                o.extend(midpoint(b"", Some(fb)));
                o
            } else if ib.len() < b.len() {
                ib.to_vec()
            } else {
                decrement(ib).unwrap_or_else(|| ib.to_vec())
            }
        }
        (Some(a), None) => {
            let ia = integer_part(a);
            let fa = &a[ia.len()..];
            increment(ia).unwrap_or_else(|| {
                let mut o = ia.to_vec();
                o.extend(midpoint(fa, None));
                o
            })
        }
        (Some(a), Some(b)) => {
            let (ia, ib) = (integer_part(a), integer_part(b));
            let (fa, fb) = (&a[ia.len()..], &b[ib.len()..]);
            if ia == ib {
                let mut o = ia.to_vec();
                o.extend(midpoint(fa, Some(fb)));
                o
            } else {
                match increment(ia) {
                    Some(i) if i.as_slice() < b => i,
                    _ => {
                        let mut o = ia.to_vec();
                        o.extend(midpoint(fa, None));
                        o
                    }
                }
            }
        }
    };
    String::from_utf8(out).expect("ascii")
}

/// `n` claves seguidas entre `a` y `b`.
pub fn n_keys_between(a: Option<&str>, b: Option<&str>, n: usize) -> Vec<String> {
    match n {
        0 => vec![],
        1 => vec![key_between(a, b)],
        _ if b.is_none() => {
            let mut c = key_between(a, b);
            let mut out = vec![c.clone()];
            for _ in 1..n {
                c = key_between(Some(&c), b);
                out.push(c.clone());
            }
            out
        }
        _ if a.is_none() => {
            let mut c = key_between(a, b);
            let mut out = vec![c.clone()];
            for _ in 1..n {
                c = key_between(a, Some(&c));
                out.push(c.clone());
            }
            out.reverse();
            out
        }
        _ => {
            let mid = n / 2;
            let c = key_between(a, b);
            let mut out = n_keys_between(a, Some(&c), mid);
            out.push(c.clone());
            out.extend(n_keys_between(Some(&c), b, n - mid - 1));
            out
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn igual_que_fractional_indexing() {
        // Valores comprobados con la librería JS del servidor (fractional-indexing)
        assert_eq!(key_between(None, None), "a0");
        assert_eq!(key_between(None, Some("a0")), "Zz");
        assert_eq!(key_between(Some("a0"), None), "a1");
        assert_eq!(key_between(Some("a0"), Some("a1")), "a0V");
        assert_eq!(key_between(Some("a1"), Some("a2")), "a1V");
        assert_eq!(key_between(Some("a0V"), Some("a1")), "a0l");
        assert_eq!(key_between(Some("Zz"), Some("a0")), "ZzV");
        assert_eq!(key_between(Some("Zz"), Some("a1")), "a0");
        assert_eq!(key_between(None, Some("Y00")), "Xzzz");
        assert_eq!(key_between(Some("bzz"), None), "c000");
        assert_eq!(key_between(Some("a0"), Some("a0V")), "a0G");
        assert_eq!(key_between(Some("a0"), Some("a0G")), "a08");
        assert_eq!(key_between(Some("b125"), Some("b129")), "b127");
        assert_eq!(key_between(Some("a0"), Some("a1V")), "a1");
        assert_eq!(key_between(Some("Zz"), Some("a01")), "a0");
        assert_eq!(key_between(None, Some("a0V")), "a0");
        assert_eq!(key_between(None, Some("b999")), "b99");
        assert_eq!(n_keys_between(None, None, 5), vec!["a0", "a1", "a2", "a3", "a4"]);
        assert_eq!(n_keys_between(Some("a4"), None, 3), vec!["a5", "a6", "a7"]);
        assert_eq!(n_keys_between(None, Some("a0"), 3), vec!["Zx", "Zy", "Zz"]);
        assert_eq!(n_keys_between(Some("a0"), Some("a2"), 3), vec!["a0V", "a1", "a1V"]);
        let mut keys = n_keys_between(None, None, 100);
        let sorted = {
            let mut s = keys.clone();
            s.sort();
            s
        };
        assert_eq!(keys, sorted);
        keys.dedup();
        assert_eq!(keys.len(), 100);
    }
}
