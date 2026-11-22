//! Cifrado de los valores secretos de las variables (tipo «secret») en disco.
//! La clave vive en el llavero del sistema (lo gestiona la app); aquí solo se usa.

use base64::Engine as _;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};

const PREFIX: &str = "enc:v1:";
const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD_NO_PAD;

#[derive(Clone)]
pub struct SecretBox {
    cipher: XChaCha20Poly1305,
}

impl std::fmt::Debug for SecretBox {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SecretBox")
    }
}

impl SecretBox {
    pub fn new(key: &[u8; 32]) -> Self {
        Self { cipher: XChaCha20Poly1305::new(key.into()) }
    }

    pub fn generate_key() -> [u8; 32] {
        rand::random()
    }

    pub fn seal(&self, plain: &str) -> String {
        if plain.is_empty() || plain.starts_with(PREFIX) {
            return plain.to_string();
        }
        let nonce: [u8; 24] = rand::random();
        let ct = self.cipher.encrypt(XNonce::from_slice(&nonce), plain.as_bytes()).expect("cifrado");
        let mut blob = nonce.to_vec();
        blob.extend(ct);
        format!("{PREFIX}{}", B64.encode(blob))
    }

    /// Si no se puede descifrar (otra clave), devuelve vacío: mejor que mostrar basura.
    pub fn open(&self, sealed: &str) -> String {
        let Some(b64) = sealed.strip_prefix(PREFIX) else { return sealed.to_string() };
        let Ok(blob) = B64.decode(b64) else { return String::new() };
        if blob.len() < 24 {
            return String::new();
        }
        self.cipher.decrypt(XNonce::from_slice(&blob[..24]), &blob[24..]).ok().and_then(|p| String::from_utf8(p).ok()).unwrap_or_default()
    }
}
