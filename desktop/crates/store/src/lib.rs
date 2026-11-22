//! Almacenamiento local de Cartero en SQLite.
//!
//! Mismo esquema lógico que el servidor (colecciones con datos en JSON, ítems en plano con
//! `parent_id` y orden fraccional, entornos, globales, historial…) para que la sincronización
//! sea directa. Cada entidad sincronizable lleva `remote_version` (la versión del servidor la
//! última vez que coincidimos) y `dirty` (hay cambios locales sin subir).

mod schema;
pub mod secrets;
pub mod sync;
pub mod sort;

use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use cartero_model::{Collection, Environment, Info, Item, POSTMAN_SCHEMA_V21, Variable};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub use secrets::SecretBox;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("base de datos: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("datos no válidos: {0}")]
    Json(#[from] serde_json::Error),
    #[error("no existe: {0}")]
    NotFound(String),
    #[error("{0}")]
    Invalid(String),
}

pub type Result<T> = std::result::Result<T, StoreError>;

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    /// Servidor al que está vinculado (None = solo en este ordenador)
    pub server_id: Option<String>,
    /// Id del workspace en el servidor
    pub remote_id: Option<String>,
    pub cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CollectionMeta {
    pub id: String,
    pub name: String,
    pub requests: usize,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EnvironmentMeta {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: String,
    pub workspace_id: String,
    pub item_id: Option<String>,
    pub method: String,
    pub url: String,
    pub status: Option<u16>,
    pub time_ms: Option<u64>,
    /// Ítem enviado (sin resolver) para poder reabrirlo
    pub request: Value,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RunRecord {
    pub id: String,
    pub workspace_id: String,
    pub collection_id: Option<String>,
    pub summary: Value,
    pub created_at: String,
}

/// Fila de ítem tal y como la guarda el servidor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ItemRow {
    pub id: String,
    pub collection_id: String,
    pub parent_id: Option<String>,
    #[serde(rename = "type")]
    pub kind: String,
    pub name: String,
    pub sort: String,
    pub data: Value,
    pub remote_version: Option<i64>,
    pub dirty: bool,
    pub deleted: bool,
}

const COLLECTION_KEYS: [&str; 5] = ["auth", "event", "variable", "protocolProfileBehavior", "description"];

/// Separa un ítem en (name, data) igual que el servidor.
pub fn item_data(item: &Item) -> Value {
    let mut v = serde_json::to_value(item).unwrap_or(Value::Null);
    if let Some(o) = v.as_object_mut() {
        o.remove("id");
        o.remove("name");
        o.remove("item");
    }
    v
}

pub fn row_to_item(row: &ItemRow, children: Option<Vec<Item>>) -> Item {
    let mut v = row.data.clone();
    if !v.is_object() {
        v = Value::Object(Map::new());
    }
    let o = v.as_object_mut().unwrap();
    o.insert("id".into(), Value::String(row.id.clone()));
    o.insert("name".into(), Value::String(row.name.clone()));
    if row.kind == "folder" {
        o.remove("request");
        o.insert("item".into(), serde_json::to_value(children.unwrap_or_default()).unwrap_or_default());
    }
    serde_json::from_value(v).unwrap_or_else(|_| Item { id: Some(row.id.clone()), name: row.name.clone(), ..Default::default() })
}

pub fn build_tree(rows: &[ItemRow]) -> Vec<Item> {
    fn build(rows: &[ItemRow], parent: Option<&str>) -> Vec<Item> {
        let mut kids: Vec<&ItemRow> = rows.iter().filter(|r| r.parent_id.as_deref() == parent && !r.deleted).collect();
        kids.sort_by(|a, b| a.sort.cmp(&b.sort));
        kids.into_iter()
            .map(|r| {
                let children = (r.kind == "folder").then(|| build(rows, Some(&r.id)));
                row_to_item(r, children)
            })
            .collect()
    }
    build(rows, None)
}

/// Datos de la colección como los guarda el servidor (auth, event, variable…, description).
pub fn collection_data(c: &Collection) -> Value {
    let full = serde_json::to_value(c).unwrap_or_default();
    let mut data = Map::new();
    for k in COLLECTION_KEYS {
        let v = if k == "description" { c.info.description.clone() } else { full.get(k).cloned() };
        if let Some(v) = v.filter(|v| !v.is_null()) {
            data.insert(k.into(), v);
        }
    }
    Value::Object(data)
}

pub fn row_to_collection(id: &str, name: &str, data: &Value, items: Vec<Item>) -> Collection {
    let mut v = serde_json::json!({ "info": { "_postman_id": id, "name": name, "schema": POSTMAN_SCHEMA_V21 }, "item": [] });
    for k in COLLECTION_KEYS {
        if let Some(x) = data.get(k).filter(|x| !x.is_null()) {
            if k == "description" {
                v["info"]["description"] = x.clone();
            } else {
                v[k] = x.clone();
            }
        }
    }
    let mut c: Collection = serde_json::from_value(v).unwrap_or_else(|_| Collection {
        info: Info { postman_id: Some(id.into()), name: name.into(), ..Default::default() },
        ..Default::default()
    });
    c.item = items;
    c
}

pub struct Store {
    conn: Mutex<Connection>,
    secrets: Option<SecretBox>,
}

impl std::fmt::Debug for Store {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Store")
    }
}

impl Store {
    pub fn open(path: &Path, secrets: Option<SecretBox>) -> Result<Self> {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let conn = Connection::open(path)?;
        Self::init(conn, secrets)
    }

    pub fn in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?, Some(SecretBox::new(&[7; 32])))
    }

    fn init(conn: Connection, secrets: Option<SecretBox>) -> Result<Self> {
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")?;
        schema::migrate(&conn)?;
        Ok(Self { conn: Mutex::new(conn), secrets })
    }

    fn db(&self) -> MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }

    // ─────────────────────────── Workspaces ───────────────────────────

    pub fn workspaces(&self) -> Result<Vec<Workspace>> {
        let db = self.db();
        let mut st = db.prepare("SELECT id, name, server_id, remote_id, cursor FROM workspaces ORDER BY created_at")?;
        let rows = st.query_map([], |r| {
            Ok(Workspace { id: r.get(0)?, name: r.get(1)?, server_id: r.get(2)?, remote_id: r.get(3)?, cursor: r.get(4)? })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn workspace(&self, id: &str) -> Result<Workspace> {
        self.workspaces()?.into_iter().find(|w| w.id == id).ok_or_else(|| StoreError::NotFound(format!("workspace {id}")))
    }

    pub fn create_workspace(&self, name: &str) -> Result<Workspace> {
        let id = new_id();
        self.db().execute("INSERT INTO workspaces (id, name, created_at) VALUES (?1, ?2, ?3)", params![id, name, now()])?;
        self.workspace(&id)
    }

    pub fn rename_workspace(&self, id: &str, name: &str) -> Result<()> {
        self.db().execute("UPDATE workspaces SET name = ?2 WHERE id = ?1", params![id, name])?;
        Ok(())
    }

    pub fn delete_workspace(&self, id: &str) -> Result<()> {
        self.db().execute("DELETE FROM workspaces WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn link_workspace(&self, id: &str, server_id: Option<&str>, remote_id: Option<&str>) -> Result<()> {
        self.db().execute(
            "UPDATE workspaces SET server_id = ?2, remote_id = ?3, cursor = NULL WHERE id = ?1",
            params![id, server_id, remote_id],
        )?;
        Ok(())
    }

    pub fn set_cursor(&self, id: &str, cursor: Option<&str>) -> Result<()> {
        self.db().execute("UPDATE workspaces SET cursor = ?2 WHERE id = ?1", params![id, cursor])?;
        Ok(())
    }

    // ─────────────────────────── Colecciones ───────────────────────────

    pub fn collections(&self, workspace: &str) -> Result<Vec<CollectionMeta>> {
        let db = self.db();
        let mut st = db.prepare(
            "SELECT c.id, c.name, c.updated_at,
                (SELECT count(*) FROM items i WHERE i.collection_id = c.id AND i.type = 'request' AND i.deleted = 0)
             FROM collections c WHERE c.workspace_id = ?1 AND c.deleted = 0 ORDER BY c.name COLLATE NOCASE",
        )?;
        let rows = st.query_map([workspace], |r| {
            Ok(CollectionMeta { id: r.get(0)?, name: r.get(1)?, updated_at: r.get(2)?, requests: r.get::<_, i64>(3)? as usize })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn collection_workspace(&self, id: &str) -> Result<String> {
        self.db()
            .query_row("SELECT workspace_id FROM collections WHERE id = ?1", [id], |r| r.get(0))
            .optional()?
            .ok_or_else(|| StoreError::NotFound(format!("colección {id}")))
    }

    pub fn item_rows(&self, collection: &str) -> Result<Vec<ItemRow>> {
        let db = self.db();
        let mut st = db.prepare(
            "SELECT id, collection_id, parent_id, type, name, sort, data, remote_version, dirty, deleted FROM items WHERE collection_id = ?1 ORDER BY sort",
        )?;
        let rows = st.query_map([collection], |r| {
            Ok(ItemRow {
                id: r.get(0)?,
                collection_id: r.get(1)?,
                parent_id: r.get(2)?,
                kind: r.get(3)?,
                name: r.get(4)?,
                sort: r.get(5)?,
                data: serde_json::from_str(&r.get::<_, String>(6)?).unwrap_or(Value::Null),
                remote_version: r.get(7)?,
                dirty: r.get(8)?,
                deleted: r.get(9)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// La colección completa, con el árbol montado.
    pub fn collection(&self, id: &str) -> Result<Collection> {
        let (name, data): (String, String) = self
            .db()
            .query_row("SELECT name, data FROM collections WHERE id = ?1 AND deleted = 0", [id], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?
            .ok_or_else(|| StoreError::NotFound(format!("colección {id}")))?;
        let rows = self.item_rows(id)?;
        Ok(row_to_collection(id, &name, &serde_json::from_str(&data)?, build_tree(&rows)))
    }

    pub fn create_collection(&self, workspace: &str, name: &str) -> Result<String> {
        self.import_collection(workspace, &Collection::new(name))
    }

    /// Guarda una colección entera con ids nuevos (importar, duplicar).
    pub fn import_collection(&self, workspace: &str, c: &Collection) -> Result<String> {
        let id = new_id();
        let mut db = self.db();
        let tx = db.transaction()?;
        let name = if c.info.name.trim().is_empty() { "Colección" } else { c.info.name.as_str() };
        tx.execute(
            "INSERT INTO collections (id, workspace_id, name, data, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, workspace, name, collection_data(c).to_string(), now()],
        )?;
        fn walk(tx: &rusqlite::Transaction, collection: &str, items: &[Item], parent: Option<&str>) -> Result<()> {
            let keys = sort::n_keys_between(None, None, items.len());
            for (item, key) in items.iter().zip(keys) {
                let id = new_id();
                let kind = if item.is_folder() { "folder" } else { "request" };
                let name = if item.name.trim().is_empty() { "Sin nombre" } else { item.name.as_str() };
                tx.execute(
                    "INSERT INTO items (id, collection_id, parent_id, type, name, sort, data, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![id, collection, parent, kind, name, key, item_data(item).to_string(), now()],
                )?;
                if item.is_folder() {
                    walk(tx, collection, item.children(), Some(&id))?;
                }
            }
            Ok(())
        }
        walk(&tx, &id, &c.item, None)?;
        tx.commit()?;
        Ok(id)
    }

    /// Guarda nombre, auth, scripts y variables de la colección (no los ítems).
    pub fn save_collection_meta(&self, c: &Collection) -> Result<()> {
        let id = c.info.postman_id.clone().ok_or_else(|| StoreError::Invalid("colección sin id".into()))?;
        self.db().execute(
            "UPDATE collections SET name = ?2, data = ?3, dirty = 1, updated_at = ?4 WHERE id = ?1",
            params![id, c.info.name, collection_data(c).to_string(), now()],
        )?;
        Ok(())
    }

    pub fn rename_collection(&self, id: &str, name: &str) -> Result<()> {
        self.db().execute("UPDATE collections SET name = ?2, dirty = 1, updated_at = ?3 WHERE id = ?1", params![id, name, now()])?;
        Ok(())
    }

    pub fn delete_collection(&self, id: &str) -> Result<()> {
        let db = self.db();
        let synced: Option<i64> =
            db.query_row("SELECT remote_version FROM collections WHERE id = ?1", [id], |r| r.get(0)).optional()?.flatten();
        if synced.is_some() {
            db.execute("UPDATE collections SET deleted = 1, dirty = 1, updated_at = ?2 WHERE id = ?1", params![id, now()])?;
        } else {
            db.execute("DELETE FROM collections WHERE id = ?1", [id])?;
        }
        Ok(())
    }

    pub fn duplicate_collection(&self, id: &str) -> Result<String> {
        let ws = self.collection_workspace(id)?;
        let mut c = self.collection(id)?;
        c.info.name = format!("{} (copia)", c.info.name);
        self.import_collection(&ws, &c)
    }

    // ─────────────────────────────── Ítems ───────────────────────────────

    fn siblings(&self, collection: &str, parent: Option<&str>) -> Result<Vec<(String, String)>> {
        let db = self.db();
        let mut st = db.prepare("SELECT id, sort FROM items WHERE collection_id = ?1 AND parent_id IS ?2 AND deleted = 0 ORDER BY sort")?;
        let rows = st.query_map(params![collection, parent], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Clave de orden para colocar un ítem en la posición `index` entre sus hermanos.
    fn sort_key_at(&self, collection: &str, parent: Option<&str>, index: usize, exclude: Option<&str>) -> Result<String> {
        let sibs: Vec<(String, String)> =
            self.siblings(collection, parent)?.into_iter().filter(|(id, _)| Some(id.as_str()) != exclude).collect();
        let index = index.min(sibs.len());
        let before = index.checked_sub(1).map(|i| sibs[i].1.as_str());
        let after = sibs.get(index).map(|s| s.1.as_str());
        Ok(sort::key_between(before, after))
    }

    pub fn item(&self, id: &str) -> Result<Item> {
        let collection: String = self
            .db()
            .query_row("SELECT collection_id FROM items WHERE id = ?1", [id], |r| r.get(0))
            .optional()?
            .ok_or_else(|| StoreError::NotFound(format!("ítem {id}")))?;
        let c = self.collection(&collection)?;
        cartero_model::tree::find(&c.item, id).cloned().ok_or_else(|| StoreError::NotFound(format!("ítem {id}")))
    }

    pub fn item_collection(&self, id: &str) -> Result<String> {
        self.db()
            .query_row("SELECT collection_id FROM items WHERE id = ?1", [id], |r| r.get(0))
            .optional()?
            .ok_or_else(|| StoreError::NotFound(format!("ítem {id}")))
    }

    /// Crea un ítem (y sus hijos si es una carpeta) en la posición dada. Devuelve el id.
    pub fn create_item(&self, collection: &str, parent: Option<&str>, index: usize, item: &Item) -> Result<String> {
        let key = self.sort_key_at(collection, parent, index, None)?;
        let id = item.id.clone().filter(|i| !i.is_empty()).unwrap_or_else(new_id);
        let kind = if item.is_folder() { "folder" } else { "request" };
        {
            let db = self.db();
            db.execute(
                "INSERT INTO items (id, collection_id, parent_id, type, name, sort, data, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![id, collection, parent, kind, item.name, key, item_data(item).to_string(), now()],
            )?;
        }
        for (i, child) in item.children().iter().enumerate() {
            self.create_item(collection, Some(&id), i, child)?;
        }
        self.touch(collection)?;
        Ok(id)
    }

    /// Guarda nombre y datos de un ítem (petición o carpeta, sin tocar sus hijos).
    pub fn save_item(&self, item: &Item) -> Result<()> {
        let n = self.db().execute(
            "UPDATE items SET name = ?2, data = ?3, dirty = 1, updated_at = ?4 WHERE id = ?1",
            params![item.id(), item.name, item_data(item).to_string(), now()],
        )?;
        if n == 0 {
            return Err(StoreError::NotFound(format!("ítem {}", item.id())));
        }
        let c = self.item_collection(item.id())?;
        self.touch(&c)
    }

    pub fn rename_item(&self, id: &str, name: &str) -> Result<()> {
        self.db().execute("UPDATE items SET name = ?2, dirty = 1, updated_at = ?3 WHERE id = ?1", params![id, name, now()])?;
        Ok(())
    }

    fn descendants(&self, collection: &str, id: &str) -> Result<Vec<String>> {
        let rows = self.item_rows(collection)?;
        let mut out = vec![];
        let mut stack = vec![id.to_string()];
        while let Some(p) = stack.pop() {
            for r in rows.iter().filter(|r| r.parent_id.as_deref() == Some(p.as_str())) {
                out.push(r.id.clone());
                stack.push(r.id.clone());
            }
        }
        Ok(out)
    }

    /// Mueve un ítem a otra carpeta (o a la raíz) y posición. También entre colecciones.
    pub fn move_item(&self, id: &str, collection: &str, parent: Option<&str>, index: usize) -> Result<()> {
        let from = self.item_collection(id)?;
        if let Some(p) = parent
            && (p == id || self.descendants(&from, id)?.iter().any(|d| d == p))
        {
            return Err(StoreError::Invalid("No se puede mover una carpeta dentro de sí misma".into()));
        }
        let key = self.sort_key_at(collection, parent, index, Some(id))?;
        let moved = if from != collection { self.descendants(&from, id)? } else { vec![] };
        let db = self.db();
        db.execute(
            "UPDATE items SET collection_id = ?2, parent_id = ?3, sort = ?4, dirty = 1, updated_at = ?5 WHERE id = ?1",
            params![id, collection, parent, key, now()],
        )?;
        for d in moved {
            db.execute("UPDATE items SET collection_id = ?2, dirty = 1 WHERE id = ?1", params![d, collection])?;
        }
        drop(db);
        self.touch(collection)?;
        if from != collection {
            self.touch(&from)?;
        }
        Ok(())
    }

    pub fn delete_item(&self, id: &str) -> Result<()> {
        let collection = self.item_collection(id)?;
        let mut ids = self.descendants(&collection, id)?;
        ids.push(id.to_string());
        let db = self.db();
        for i in &ids {
            let synced: Option<i64> =
                db.query_row("SELECT remote_version FROM items WHERE id = ?1", [i], |r| r.get(0)).optional()?.flatten();
            if synced.is_some() {
                db.execute("UPDATE items SET deleted = 1, dirty = 1, updated_at = ?2 WHERE id = ?1", params![i, now()])?;
            } else {
                db.execute("DELETE FROM items WHERE id = ?1", [i])?;
            }
        }
        drop(db);
        self.touch(&collection)
    }

    /// Duplica un ítem justo debajo del original. Devuelve el id de la copia.
    pub fn duplicate_item(&self, id: &str) -> Result<String> {
        let collection = self.item_collection(id)?;
        let c = self.collection(&collection)?;
        let original = cartero_model::tree::find(&c.item, id).ok_or_else(|| StoreError::NotFound(format!("ítem {id}")))?;
        let mut copy = cartero_model::tree::duplicate(original);
        copy.name = format!("{} (copia)", copy.name);
        let parent = cartero_model::tree::ancestors(&c.item, id).and_then(|a| a.last().map(|p| p.id().to_string()));
        let sibs = self.siblings(&collection, parent.as_deref())?;
        let pos = sibs.iter().position(|(s, _)| s == id).map(|p| p + 1).unwrap_or(sibs.len());
        self.create_item(&collection, parent.as_deref(), pos, &copy)
    }

    fn touch(&self, collection: &str) -> Result<()> {
        self.db().execute("UPDATE collections SET updated_at = ?2 WHERE id = ?1", params![collection, now()])?;
        Ok(())
    }

    // ───────────────────────────── Entornos ─────────────────────────────

    fn seal_values(&self, values: &[Variable]) -> String {
        let sealed: Vec<Variable> = values
            .iter()
            .map(|v| {
                let mut v = v.clone();
                if let (true, Some(sb)) = (v.is_secret(), &self.secrets) {
                    v.value = Some(Value::String(sb.seal(&v.value_str())));
                }
                v
            })
            .collect();
        serde_json::to_string(&sealed).unwrap_or_else(|_| "[]".into())
    }

    fn open_values(&self, raw: &str) -> Vec<Variable> {
        let mut values: Vec<Variable> = serde_json::from_str(raw).unwrap_or_default();
        if let Some(sb) = &self.secrets {
            for v in values.iter_mut().filter(|v| v.is_secret()) {
                v.value = Some(Value::String(sb.open(&v.value_str())));
            }
        }
        values
    }

    pub fn environments(&self, workspace: &str) -> Result<Vec<EnvironmentMeta>> {
        let db = self.db();
        let mut st =
            db.prepare("SELECT id, name FROM environments WHERE workspace_id = ?1 AND deleted = 0 ORDER BY name COLLATE NOCASE")?;
        let rows = st.query_map([workspace], |r| Ok(EnvironmentMeta { id: r.get(0)?, name: r.get(1)? }))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn environment(&self, id: &str) -> Result<Environment> {
        let (name, values): (String, String) = self
            .db()
            .query_row("SELECT name, \"values\" FROM environments WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?
            .ok_or_else(|| StoreError::NotFound(format!("entorno {id}")))?;
        Ok(Environment { id: Some(id.into()), name, values: self.open_values(&values) })
    }

    pub fn create_environment(&self, workspace: &str, env: &Environment) -> Result<String> {
        let id = new_id();
        self.db().execute(
            "INSERT INTO environments (id, workspace_id, name, \"values\", updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, workspace, env.name, self.seal_values(&env.values), now()],
        )?;
        Ok(id)
    }

    pub fn save_environment(&self, env: &Environment) -> Result<()> {
        let id = env.id.clone().ok_or_else(|| StoreError::Invalid("entorno sin id".into()))?;
        self.db().execute(
            "UPDATE environments SET name = ?2, \"values\" = ?3, dirty = 1, updated_at = ?4 WHERE id = ?1",
            params![id, env.name, self.seal_values(&env.values), now()],
        )?;
        Ok(())
    }

    pub fn delete_environment(&self, id: &str) -> Result<()> {
        let db = self.db();
        let synced: Option<i64> =
            db.query_row("SELECT remote_version FROM environments WHERE id = ?1", [id], |r| r.get(0)).optional()?.flatten();
        if synced.is_some() {
            db.execute("UPDATE environments SET deleted = 1, dirty = 1, updated_at = ?2 WHERE id = ?1", params![id, now()])?;
        } else {
            db.execute("DELETE FROM environments WHERE id = ?1", [id])?;
        }
        Ok(())
    }

    pub fn environment_workspace(&self, id: &str) -> Result<String> {
        self.db()
            .query_row("SELECT workspace_id FROM environments WHERE id = ?1", [id], |r| r.get(0))
            .optional()?
            .ok_or_else(|| StoreError::NotFound(format!("entorno {id}")))
    }

    // ───────────────────────────── Globales ─────────────────────────────

    pub fn globals(&self, workspace: &str) -> Result<Vec<Variable>> {
        let raw: Option<String> =
            self.db().query_row("SELECT \"values\" FROM globals WHERE workspace_id = ?1", [workspace], |r| r.get(0)).optional()?;
        Ok(raw.map(|r| self.open_values(&r)).unwrap_or_default())
    }

    pub fn save_globals(&self, workspace: &str, values: &[Variable]) -> Result<()> {
        self.db().execute(
            "INSERT INTO globals (workspace_id, \"values\", dirty, updated_at) VALUES (?1, ?2, 1, ?3)
             ON CONFLICT(workspace_id) DO UPDATE SET \"values\" = excluded.\"values\", dirty = 1, updated_at = excluded.updated_at",
            params![workspace, self.seal_values(values), now()],
        )?;
        Ok(())
    }

    // ───────────────────────────── Historial ─────────────────────────────

    pub fn add_history(&self, e: &HistoryEntry) -> Result<()> {
        let db = self.db();
        db.execute(
            "INSERT INTO history (id, workspace_id, item_id, method, url, status, time_ms, request, created_at, uploaded) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0)",
            params![e.id, e.workspace_id, e.item_id, e.method, e.url, e.status, e.time_ms.map(|t| t as i64), e.request.to_string(), e.created_at],
        )?;
        // Solo guardamos las últimas 1000 por workspace
        db.execute(
            "DELETE FROM history WHERE workspace_id = ?1 AND id NOT IN (SELECT id FROM history WHERE workspace_id = ?1 ORDER BY created_at DESC LIMIT 1000)",
            [&e.workspace_id],
        )?;
        Ok(())
    }

    pub fn history(&self, workspace: &str, limit: usize) -> Result<Vec<HistoryEntry>> {
        let db = self.db();
        let mut st = db.prepare(
            "SELECT id, workspace_id, item_id, method, url, status, time_ms, request, created_at FROM history WHERE workspace_id = ?1 ORDER BY created_at DESC LIMIT ?2",
        )?;
        let rows = st.query_map(params![workspace, limit as i64], |r| {
            Ok(HistoryEntry {
                id: r.get(0)?,
                workspace_id: r.get(1)?,
                item_id: r.get(2)?,
                method: r.get(3)?,
                url: r.get(4)?,
                status: r.get(5)?,
                time_ms: r.get::<_, Option<i64>>(6)?.map(|t| t as u64),
                request: serde_json::from_str(&r.get::<_, String>(7)?).unwrap_or(Value::Null),
                created_at: r.get(8)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn delete_history(&self, id: &str) -> Result<()> {
        self.db().execute("DELETE FROM history WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn clear_history(&self, workspace: &str) -> Result<()> {
        self.db().execute("DELETE FROM history WHERE workspace_id = ?1", [workspace])?;
        Ok(())
    }

    /// Historial aún no subido al servidor (y lo marca como subido con `mark_history_uploaded`).
    pub fn pending_history(&self, workspace: &str, limit: usize) -> Result<Vec<HistoryEntry>> {
        let ids: Vec<String> = {
            let db = self.db();
            let mut st = db.prepare("SELECT id FROM history WHERE workspace_id = ?1 AND uploaded = 0 ORDER BY created_at LIMIT ?2")?;
            st.query_map(params![workspace, limit as i64], |r| r.get(0))?.collect::<std::result::Result<_, _>>()?
        };
        Ok(self.history(workspace, 1000)?.into_iter().filter(|h| ids.contains(&h.id)).collect())
    }

    pub fn mark_history_uploaded(&self, ids: &[String]) -> Result<()> {
        let db = self.db();
        for id in ids {
            db.execute("UPDATE history SET uploaded = 1 WHERE id = ?1", [id])?;
        }
        Ok(())
    }

    // ───────────────────────────── Ejecuciones ─────────────────────────────

    pub fn add_run(&self, workspace: &str, collection: Option<&str>, summary: &Value) -> Result<String> {
        let id = new_id();
        self.db().execute(
            "INSERT INTO runs (id, workspace_id, collection_id, summary, created_at, uploaded) VALUES (?1, ?2, ?3, ?4, ?5, 0)",
            params![id, workspace, collection, summary.to_string(), now()],
        )?;
        Ok(id)
    }

    pub fn runs(&self, workspace: &str, limit: usize) -> Result<Vec<RunRecord>> {
        let db = self.db();
        let mut st = db.prepare("SELECT id, workspace_id, collection_id, summary, created_at FROM runs WHERE workspace_id = ?1 ORDER BY created_at DESC LIMIT ?2")?;
        let rows = st.query_map(params![workspace, limit as i64], |r| {
            Ok(RunRecord {
                id: r.get(0)?,
                workspace_id: r.get(1)?,
                collection_id: r.get(2)?,
                summary: serde_json::from_str(&r.get::<_, String>(3)?).unwrap_or(Value::Null),
                created_at: r.get(4)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn pending_runs(&self, workspace: &str) -> Result<Vec<RunRecord>> {
        let ids: Vec<String> = {
            let db = self.db();
            let mut st = db.prepare("SELECT id FROM runs WHERE workspace_id = ?1 AND uploaded = 0")?;
            st.query_map([workspace], |r| r.get(0))?.collect::<std::result::Result<_, _>>()?
        };
        Ok(self.runs(workspace, 10_000)?.into_iter().filter(|r| ids.contains(&r.id)).collect())
    }

    pub fn mark_run_uploaded(&self, id: &str) -> Result<()> {
        self.db().execute("UPDATE runs SET uploaded = 1 WHERE id = ?1", [id])?;
        Ok(())
    }

    // ─────────────────────────────── Cookies ───────────────────────────────

    pub fn cookie_jar(&self, workspace: &str) -> Result<Option<String>> {
        Ok(self.db().query_row("SELECT jar FROM cookie_jars WHERE workspace_id = ?1", [workspace], |r| r.get(0)).optional()?)
    }

    pub fn save_cookie_jar(&self, workspace: &str, json: &str) -> Result<()> {
        self.db().execute(
            "INSERT INTO cookie_jars (workspace_id, jar) VALUES (?1, ?2) ON CONFLICT(workspace_id) DO UPDATE SET jar = excluded.jar",
            params![workspace, json],
        )?;
        Ok(())
    }

    // ─────────────────────────────── Ajustes ───────────────────────────────

    pub fn setting<T: serde::de::DeserializeOwned>(&self, key: &str) -> Option<T> {
        let raw: Option<String> =
            self.db().query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).optional().ok().flatten();
        raw.and_then(|r| serde_json::from_str(&r).ok())
    }

    pub fn set_setting<T: Serialize>(&self, key: &str, value: &T) -> Result<()> {
        self.db().execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, serde_json::to_string(value)?],
        )?;
        Ok(())
    }

    /// Acceso directo a la conexión (sincronización).
    pub fn with_conn<R>(&self, f: impl FnOnce(&mut Connection) -> Result<R>) -> Result<R> {
        let mut db = self.db();
        f(&mut db)
    }

    pub fn secrets(&self) -> Option<&SecretBox> {
        self.secrets.as_ref()
    }
}

#[cfg(test)]
mod tests;
