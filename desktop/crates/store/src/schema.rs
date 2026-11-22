//! Migraciones del esquema (PRAGMA user_version).

use rusqlite::Connection;

const MIGRATIONS: &[&str] = &[
    // 1: esquema inicial
    r#"
    CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        server_id TEXT,
        remote_id TEXT,
        cursor TEXT,
        created_at TEXT NOT NULL
    );
    CREATE TABLE collections (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        data TEXT NOT NULL DEFAULT '{}',
        remote_version INTEGER,
        dirty INTEGER NOT NULL DEFAULT 1,
        deleted INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
    );
    CREATE INDEX collections_ws ON collections(workspace_id);
    CREATE TABLE items (
        id TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        parent_id TEXT,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        sort TEXT NOT NULL,
        data TEXT NOT NULL DEFAULT '{}',
        remote_version INTEGER,
        dirty INTEGER NOT NULL DEFAULT 1,
        deleted INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
    );
    CREATE INDEX items_collection ON items(collection_id);
    CREATE INDEX items_parent ON items(parent_id);
    CREATE TABLE environments (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        "values" TEXT NOT NULL DEFAULT '[]',
        remote_version INTEGER,
        dirty INTEGER NOT NULL DEFAULT 1,
        deleted INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE globals (
        workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
        "values" TEXT NOT NULL DEFAULT '[]',
        dirty INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE history (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        item_id TEXT,
        method TEXT NOT NULL,
        url TEXT NOT NULL,
        status INTEGER,
        time_ms INTEGER,
        request TEXT NOT NULL,
        created_at TEXT NOT NULL,
        uploaded INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX history_ws ON history(workspace_id, created_at);
    CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        collection_id TEXT,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL,
        uploaded INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE cookie_jars (
        workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
        jar TEXT NOT NULL
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE conflicts (
        entity TEXT NOT NULL,
        id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        remote TEXT NOT NULL,
        remote_version INTEGER,
        created_at TEXT NOT NULL,
        PRIMARY KEY (entity, id)
    );
    "#,
];

pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let version: usize = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(version) {
        conn.execute_batch(&format!("BEGIN; {sql}; PRAGMA user_version = {}; COMMIT;", i + 1))?;
    }
    Ok(())
}
