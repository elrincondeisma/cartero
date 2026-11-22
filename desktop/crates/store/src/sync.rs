//! Primitivas de sincronización: qué hay que subir, aplicar lo que llega del servidor y
//! guardar conflictos. El protocolo (HTTP) está en el crate `cartero-sync`.
//!
//! Cada entidad guarda en `base` el contenido del servidor visto por última vez. Al subir se
//! envía esa base; si el servidor tiene otra cosa, hay conflicto.

use cartero_model::Variable;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{Result, Store, now};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Entity {
    Collection,
    Item,
    Environment,
    Globals,
}

impl Entity {
    pub fn as_str(self) -> &'static str {
        match self {
            Entity::Collection => "collection",
            Entity::Item => "item",
            Entity::Environment => "environment",
            Entity::Globals => "globals",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "collection" => Entity::Collection,
            "item" => Entity::Item,
            "environment" => Entity::Environment,
            "globals" => Entity::Globals,
            _ => return None,
        })
    }
    fn table(self) -> &'static str {
        match self {
            Entity::Collection => "collections",
            Entity::Item => "items",
            Entity::Environment => "environments",
            Entity::Globals => "globals",
        }
    }
}

/// Un cambio local pendiente de subir.
#[derive(Debug, Clone, PartialEq)]
pub struct Pending {
    pub entity: Entity,
    /// En las globales, el id del workspace
    pub id: String,
    pub delete: bool,
    /// Contenido del servidor visto por última vez (None = nunca se subió)
    pub base: Option<Value>,
    pub data: Value,
    pub force: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Conflict {
    pub entity: Entity,
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub local: Value,
    pub remote: Value,
}

fn parse(s: Option<String>) -> Option<Value> {
    s.and_then(|s| serde_json::from_str(&s).ok())
}

impl Store {
    fn seal_json(&self, v: &Value) -> String {
        match &self.secrets {
            Some(sb) => sb.seal(&v.to_string()),
            None => v.to_string(),
        }
    }

    fn open_json(&self, s: Option<String>) -> Option<Value> {
        let s = s?;
        let plain = match &self.secrets {
            Some(sb) => sb.open(&s),
            None => s,
        };
        serde_json::from_str(&plain).ok()
    }

    /// Todo lo que hay que subir de un workspace.
    pub fn pending(&self, workspace: &str) -> Result<Vec<Pending>> {
        let forced: Vec<(String, String)> = {
            let db = self.db();
            let mut st = db.prepare("SELECT entity, id FROM conflicts WHERE workspace_id = ?1 AND force = 1")?;
            st.query_map([workspace], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<std::result::Result<_, _>>()?
        };
        let is_forced = |e: Entity, id: &str| forced.iter().any(|(fe, fid)| fe == e.as_str() && fid == id);
        let mut out = vec![];
        {
            let db = self.db();
            let mut st = db.prepare("SELECT id, name, data, base, deleted, remote_version FROM collections WHERE workspace_id = ?1 AND dirty = 1")?;
            let rows = st.query_map([workspace], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, Option<String>>(3)?, r.get::<_, bool>(4)?, r.get::<_, Option<i64>>(5)?))
            })?;
            for row in rows {
                let (id, name, data, base, deleted, rv) = row?;
                if deleted && rv.is_none() {
                    continue;
                }
                let data: Value = serde_json::from_str(&data).unwrap_or(json!({}));
                out.push(Pending { entity: Entity::Collection, force: is_forced(Entity::Collection, &id), id, delete: deleted, base: parse(base), data: json!({ "name": name, "data": data }) });
            }
            let mut st = db.prepare(
                "SELECT i.id, i.collection_id, i.parent_id, i.type, i.name, i.sort, i.data, i.base, i.deleted, i.remote_version
                 FROM items i JOIN collections c ON c.id = i.collection_id WHERE c.workspace_id = ?1 AND i.dirty = 1",
            )?;
            let rows = st.query_map([workspace], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, String>(6)?,
                    r.get::<_, Option<String>>(7)?,
                    r.get::<_, bool>(8)?,
                    r.get::<_, Option<i64>>(9)?,
                ))
            })?;
            for row in rows {
                let (id, cid, parent, kind, name, sort, data, base, deleted, rv) = row?;
                if deleted && rv.is_none() {
                    continue;
                }
                let data: Value = serde_json::from_str(&data).unwrap_or(json!({}));
                out.push(Pending {
                    entity: Entity::Item,
                    force: is_forced(Entity::Item, &id),
                    id,
                    delete: deleted,
                    base: parse(base),
                    data: json!({ "collectionId": cid, "parentId": parent, "type": kind, "name": name, "sort": sort, "data": data }),
                });
            }
        }
        let envs: Vec<(String, String, String, Option<String>, bool, Option<i64>)> = {
            let db = self.db();
            let mut st = db.prepare("SELECT id, name, \"values\", base, deleted, remote_version FROM environments WHERE workspace_id = ?1 AND dirty = 1")?;
            st.query_map([workspace], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?.collect::<std::result::Result<_, _>>()?
        };
        for (id, name, values, base, deleted, rv) in envs {
            if deleted && rv.is_none() {
                continue;
            }
            let values = self.open_values(&values);
            out.push(Pending { entity: Entity::Environment, force: is_forced(Entity::Environment, &id), id, delete: deleted, base: self.open_json(base), data: json!({ "name": name, "values": values }) });
        }
        let globals: Option<(String, Option<String>)> =
            self.db().query_row("SELECT \"values\", base FROM globals WHERE workspace_id = ?1 AND dirty = 1", [workspace], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
        if let Some((values, base)) = globals {
            out.push(Pending {
                entity: Entity::Globals,
                id: workspace.to_string(),
                delete: false,
                base: self.open_json(base).or_else(|| Some(json!({ "values": [] }))),
                data: json!({ "values": self.open_values(&values) }),
                force: is_forced(Entity::Globals, workspace),
            });
        }
        // Primero lo que hay que crear (colecciones antes que ítems, padres antes que hijos)
        out.sort_by_key(|p| (p.delete, p.entity as u8));
        Ok(out)
    }

    /// Lo subido se ha aceptado: la base pasa a ser lo que se envió.
    pub fn mark_synced(&self, p: &Pending, version: Option<i64>) -> Result<()> {
        let db = self.db();
        if p.delete {
            db.execute(&format!("DELETE FROM {} WHERE id = ?1", p.entity.table()), [&p.id])?;
        } else {
            match p.entity {
                Entity::Globals => {
                    db.execute("UPDATE globals SET dirty = 0, base = ?2, remote_version = ?3 WHERE workspace_id = ?1", params![p.id, self.seal_json(&p.data), version])?;
                }
                Entity::Environment => {
                    db.execute("UPDATE environments SET dirty = 0, base = ?2, remote_version = ?3 WHERE id = ?1", params![p.id, self.seal_json(&p.data), version])?;
                }
                e => {
                    db.execute(&format!("UPDATE {} SET dirty = 0, base = ?2, remote_version = ?3 WHERE id = ?1", e.table()), params![p.id, p.data.to_string(), version])?;
                }
            }
        }
        db.execute("DELETE FROM conflicts WHERE entity = ?1 AND id = ?2", params![p.entity.as_str(), p.id])?;
        Ok(())
    }

    fn is_dirty(&self, entity: Entity, id: &str) -> Result<Option<bool>> {
        let col = if entity == Entity::Globals { "workspace_id" } else { "id" };
        Ok(self.db().query_row(&format!("SELECT dirty FROM {} WHERE {col} = ?1", entity.table()), [id], |r| r.get(0)).optional()?)
    }

    /// Aplica una colección que llega del servidor (si aquí no hay cambios sin subir, o `force`).
    pub fn apply_remote_collection(&self, workspace: &str, id: &str, content: &Value, version: i64, force: bool) -> Result<bool> {
        if !force && self.is_dirty(Entity::Collection, id)? == Some(true) {
            return Ok(false);
        }
        let name = content["name"].as_str().unwrap_or("Colección");
        let data = content.get("data").cloned().unwrap_or(json!({}));
        self.db().execute(
            "INSERT INTO collections (id, workspace_id, name, data, remote_version, dirty, deleted, updated_at, base) VALUES (?1, ?2, ?3, ?4, ?5, 0, 0, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data, remote_version = excluded.remote_version, dirty = 0, deleted = 0, updated_at = excluded.updated_at, base = excluded.base",
            params![id, workspace, name, data.to_string(), version, now(), content.to_string()],
        )?;
        Ok(true)
    }

    pub fn apply_remote_item(&self, id: &str, content: &Value, version: i64, force: bool) -> Result<bool> {
        if !force && self.is_dirty(Entity::Item, id)? == Some(true) {
            return Ok(false);
        }
        let s = |k: &str| content[k].as_str().map(String::from);
        self.db().execute(
            "INSERT INTO items (id, collection_id, parent_id, type, name, sort, data, remote_version, dirty, deleted, updated_at, base) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, 0, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET collection_id = excluded.collection_id, parent_id = excluded.parent_id, type = excluded.type, name = excluded.name, sort = excluded.sort,
                data = excluded.data, remote_version = excluded.remote_version, dirty = 0, deleted = 0, updated_at = excluded.updated_at, base = excluded.base",
            params![
                id,
                s("collectionId"),
                s("parentId"),
                s("type").unwrap_or_else(|| "request".into()),
                s("name").unwrap_or_default(),
                s("sort").unwrap_or_else(|| "a0".into()),
                content.get("data").cloned().unwrap_or(json!({})).to_string(),
                version,
                now(),
                content.to_string()
            ],
        )?;
        Ok(true)
    }

    pub fn apply_remote_environment(&self, workspace: &str, id: &str, content: &Value, version: i64, force: bool) -> Result<bool> {
        if !force && self.is_dirty(Entity::Environment, id)? == Some(true) {
            return Ok(false);
        }
        let values: Vec<Variable> = serde_json::from_value(content["values"].clone()).unwrap_or_default();
        self.db().execute(
            "INSERT INTO environments (id, workspace_id, name, \"values\", remote_version, dirty, deleted, updated_at, base) VALUES (?1, ?2, ?3, ?4, ?5, 0, 0, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, \"values\" = excluded.\"values\", remote_version = excluded.remote_version, dirty = 0, deleted = 0, updated_at = excluded.updated_at, base = excluded.base",
            params![id, workspace, content["name"].as_str().unwrap_or("Entorno"), self.seal_values(&values), version, now(), self.seal_json(content)],
        )?;
        Ok(true)
    }

    pub fn apply_remote_globals(&self, workspace: &str, content: &Value, version: i64, force: bool) -> Result<bool> {
        if !force && self.is_dirty(Entity::Globals, workspace)? == Some(true) {
            return Ok(false);
        }
        let values: Vec<Variable> = serde_json::from_value(content["values"].clone()).unwrap_or_default();
        self.db().execute(
            "INSERT INTO globals (workspace_id, \"values\", dirty, updated_at, base, remote_version) VALUES (?1, ?2, 0, ?3, ?4, ?5)
             ON CONFLICT(workspace_id) DO UPDATE SET \"values\" = excluded.\"values\", dirty = 0, updated_at = excluded.updated_at, base = excluded.base, remote_version = excluded.remote_version",
            params![workspace, self.seal_values(&values), now(), self.seal_json(content), version],
        )?;
        Ok(true)
    }

    /// Algo se borró en el servidor: se borra aquí salvo que tenga cambios sin subir.
    pub fn apply_remote_deletion(&self, entity: Entity, id: &str) -> Result<bool> {
        if self.is_dirty(entity, id)? == Some(true) {
            return Ok(false);
        }
        self.db().execute(&format!("DELETE FROM {} WHERE id = ?1", entity.table()), [id])?;
        Ok(true)
    }

    /// Tras una sincronización completa: quita lo que ya se había subido y ya no está en el
    /// servidor (lo nuevo sin subir se queda).
    pub fn apply_remote_deletion_if_synced(&self, entity: Entity, id: &str) -> Result<bool> {
        let synced: Option<Option<i64>> =
            self.db().query_row(&format!("SELECT remote_version FROM {} WHERE id = ?1 AND dirty = 0", entity.table()), [id], |r| r.get(0)).optional()?;
        match synced {
            Some(Some(_)) => {
                self.db().execute(&format!("DELETE FROM {} WHERE id = ?1", entity.table()), [id])?;
                Ok(true)
            }
            _ => Ok(false),
        }
    }

    /// Al vincular un workspace con el servidor, todo lo local queda pendiente de subir.
    pub fn mark_all_dirty(&self, workspace: &str) -> Result<()> {
        let db = self.db();
        db.execute("UPDATE collections SET dirty = 1, base = NULL, remote_version = NULL WHERE workspace_id = ?1", [workspace])?;
        db.execute("UPDATE items SET dirty = 1, base = NULL, remote_version = NULL WHERE collection_id IN (SELECT id FROM collections WHERE workspace_id = ?1)", [workspace])?;
        db.execute("UPDATE environments SET dirty = 1, base = NULL, remote_version = NULL WHERE workspace_id = ?1", [workspace])?;
        db.execute("UPDATE globals SET dirty = 1, base = NULL, remote_version = NULL WHERE workspace_id = ?1", [workspace])?;
        db.execute("DELETE FROM conflicts WHERE workspace_id = ?1", [workspace])?;
        Ok(())
    }

    // ───────────────────────────── Conflictos ─────────────────────────────

    pub fn add_conflict(&self, workspace: &str, p: &Pending, remote: &Value) -> Result<()> {
        let name = p.data["name"].as_str().unwrap_or(if p.entity == Entity::Globals { "Globales" } else { "" }).to_string();
        self.db().execute(
            "INSERT INTO conflicts (entity, id, workspace_id, name, remote, remote_version, created_at, force) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)
             ON CONFLICT(entity, id) DO UPDATE SET remote = excluded.remote, remote_version = excluded.remote_version, name = excluded.name, force = 0",
            params![p.entity.as_str(), p.id, workspace, name, remote.to_string(), remote["version"].as_i64(), now()],
        )?;
        Ok(())
    }

    pub fn conflicts(&self, workspace: &str) -> Result<Vec<Conflict>> {
        let rows: Vec<(String, String, String, String)> = {
            let db = self.db();
            let mut st = db.prepare("SELECT entity, id, name, remote FROM conflicts WHERE workspace_id = ?1 AND force = 0 ORDER BY created_at")?;
            st.query_map([workspace], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<std::result::Result<_, _>>()?
        };
        let pending = self.pending(workspace)?;
        Ok(rows
            .into_iter()
            .filter_map(|(e, id, name, remote)| {
                let entity = Entity::parse(&e)?;
                let local = pending.iter().find(|p| p.entity == entity && p.id == id).map(|p| p.data.clone()).unwrap_or(Value::Null);
                Some(Conflict { entity, id, workspace_id: workspace.to_string(), name, local, remote: serde_json::from_str(&remote).unwrap_or(Value::Null) })
            })
            .collect())
    }

    /// Resolver un conflicto: quedarse con lo local (se sube forzando) o con lo del servidor.
    pub fn resolve_conflict(&self, workspace: &str, c: &Conflict, keep_local: bool) -> Result<()> {
        if keep_local {
            self.db().execute("UPDATE conflicts SET force = 1 WHERE entity = ?1 AND id = ?2", params![c.entity.as_str(), c.id])?;
            return Ok(());
        }
        let v = c.remote["version"].as_i64().unwrap_or(1);
        let gone = c.remote.is_null();
        match c.entity {
            Entity::Collection if gone => {
                self.db().execute("DELETE FROM collections WHERE id = ?1", [&c.id])?;
            }
            Entity::Collection => {
                self.apply_remote_collection(workspace, &c.id, &strip_version(&c.remote), v, true)?;
            }
            Entity::Item => {
                self.apply_remote_item(&c.id, &strip_version(&c.remote), v, true)?;
            }
            Entity::Environment => {
                self.apply_remote_environment(workspace, &c.id, &strip_version(&c.remote), v, true)?;
            }
            Entity::Globals => {
                self.apply_remote_globals(workspace, &strip_version(&c.remote), v, true)?;
            }
        }
        self.db().execute("DELETE FROM conflicts WHERE entity = ?1 AND id = ?2", params![c.entity.as_str(), c.id])?;
        Ok(())
    }
}

/// El servidor manda `version` junto al contenido; la base es solo el contenido.
pub fn strip_version(v: &Value) -> Value {
    let mut v = v.clone();
    if let Some(o) = v.as_object_mut() {
        o.remove("version");
        o.remove("id");
    }
    v
}
