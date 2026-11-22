//! Modelo de datos de Cartero: superconjunto de Postman Collection v2.1, con importación y
//! exportación sin pérdidas, `{{variables}}`, URL y generación de código.

pub mod codegen;
pub mod export;
pub mod import;
pub mod prepare;
pub mod tree;
pub mod types;
pub mod url;
pub mod vars;

pub use types::*;

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}
