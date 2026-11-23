//! Estado global de la app: base de datos, workspace activo, colecciones, entornos, historial
//! y ajustes. Las vistas lo observan y se repintan cuando cambia.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use base64::Engine as _;
use cartero_http::CookieJar;
use cartero_model::vars::{Scope, to_scope};
use cartero_model::{Collection, Environment, Item, Variable};
use cartero_runner::{RunContext, VarState};
use cartero_store::{CollectionMeta, EnvironmentMeta, HistoryEntry, SecretBox, Store, Workspace};
use gpui_kit::{Context, EventEmitter};
use tokio::sync::Mutex;

use crate::settings::Settings;

/// Servidor de Cartero conectado (el token se guarda cifrado aparte).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ServerInfo {
    pub id: String,
    pub url: String,
    pub user_id: String,
    pub email: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub enum SyncStatus {
    #[default]
    Local,
    Syncing,
    Synced(String),
    Offline(String),
    Error(String),
}

#[derive(Debug, Clone, PartialEq)]
pub enum StateEvent {
    Sync,
    /// Han llegado cambios del servidor
    RemoteChanged,
    Workspace,
    Collections,
    Environments,
    History,
    Settings,
    /// Un ítem guardado desde otro sitio (para refrescar su pestaña)
    ItemChanged(String),
    ItemDeleted(String),
}

pub struct AppState {
    pub store: Arc<Store>,
    pub workspaces: Vec<Workspace>,
    pub workspace: Workspace,
    pub collections: Vec<CollectionMeta>,
    /// Árbol completo de cada colección del workspace (para la barra lateral y la herencia)
    pub trees: HashMap<String, Collection>,
    pub environments: Vec<EnvironmentMeta>,
    pub active_env: Option<String>,
    pub globals: Vec<Variable>,
    pub history: Vec<HistoryEntry>,
    pub settings: Settings,
    pub jar: Arc<Mutex<CookieJar>>,
    pub data_dir: PathBuf,
    pub servers: Vec<ServerInfo>,
    pub sync_status: SyncStatus,
    pub conflicts: usize,
    pub presence: Vec<cartero_sync::realtime::Presence>,
    /// Mocks locales en marcha, por colección
    pub mocks: HashMap<String, crate::mock::LocalMock>,
}

impl EventEmitter<StateEvent> for AppState {}

pub fn data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("CARTERO_DATA_DIR") {
        return PathBuf::from(dir);
    }
    dirs::data_dir().unwrap_or_else(|| PathBuf::from(".")).join("Cartero")
}

/// Clave para cifrar las variables secretas: en el llavero del sistema; si no hay llavero
/// (Linux sin servicio de secretos), en un fichero solo legible por el usuario.
fn secret_key(dir: &std::path::Path) -> [u8; 32] {
    let b64 = base64::engine::general_purpose::STANDARD;
    let decode = |s: &str| -> Option<[u8; 32]> { b64.decode(s.trim()).ok()?.try_into().ok() };
    let file = dir.join("secret.key");
    if std::env::var("CARTERO_DATA_DIR").is_err()
        && let Ok(entry) = keyring::Entry::new("cartero-desktop", "secret-key")
    {
        if let Ok(s) = entry.get_password()
            && let Some(k) = decode(&s)
        {
            return k;
        }
        // Si ya había un fichero (instalación anterior sin llavero), se respeta
        let key = std::fs::read_to_string(&file).ok().and_then(|s| decode(&s)).unwrap_or_else(SecretBox::generate_key);
        if entry.set_password(&b64.encode(key)).is_ok() {
            return key;
        }
    }
    if let Some(k) = std::fs::read_to_string(&file).ok().and_then(|s| decode(&s)) {
        return k;
    }
    let key = SecretBox::generate_key();
    let _ = std::fs::create_dir_all(dir);
    let _ = std::fs::write(&file, b64.encode(key));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600));
    }
    key
}

impl AppState {
    pub fn server_token(&self, id: &str) -> Option<String> {
        let sealed: String = self.store.setting(&format!("server-token:{id}"))?;
        Some(self.store.secrets().map(|s| s.open(&sealed)).unwrap_or(sealed)).filter(|t| !t.is_empty())
    }

    pub fn save_server(&mut self, info: ServerInfo, token: &str, cx: &mut Context<Self>) {
        let sealed = self.store.secrets().map(|s| s.seal(token)).unwrap_or_else(|| token.to_string());
        let _ = self.store.set_setting(&format!("server-token:{}", info.id), &sealed);
        self.servers.retain(|s| s.id != info.id);
        self.servers.push(info);
        let _ = self.store.set_setting("servers", &self.servers);
        cx.emit(StateEvent::Sync);
        cx.notify();
    }

    pub fn remove_server(&mut self, id: &str, cx: &mut Context<Self>) {
        self.servers.retain(|s| s.id != id);
        let _ = self.store.set_setting("servers", &self.servers);
        let _ = self.store.set_setting(&format!("server-token:{id}"), &"");
        for w in self.workspaces.clone().into_iter().filter(|w| w.server_id.as_deref() == Some(id)) {
            let _ = self.store.link_workspace(&w.id, None, None);
        }
        self.refresh_workspaces(cx);
        cx.emit(StateEvent::Sync);
    }

    /// Cliente del servidor al que está vinculado el workspace activo.
    pub fn sync_client(&self) -> Option<(cartero_sync::Client, String, ServerInfo)> {
        let sid = self.workspace.server_id.as_ref()?;
        let remote = self.workspace.remote_id.clone()?;
        let server = self.servers.iter().find(|s| &s.id == sid)?.clone();
        let token = self.server_token(sid)?;
        Some((cartero_sync::Client::new(&server.url, &token, self.settings.http_options()), remote, server))
    }

    pub fn client_for(&self, server: &ServerInfo) -> Option<cartero_sync::Client> {
        Some(cartero_sync::Client::new(&server.url, &self.server_token(&server.id)?, self.settings.http_options()))
    }

    pub fn open() -> anyhow::Result<Self> {
        let dir = data_dir();
        std::fs::create_dir_all(&dir)?;
        let store = Arc::new(Store::open(&dir.join("cartero.db"), Some(SecretBox::new(&secret_key(&dir))))?);
        let settings: Settings = store.setting("app").unwrap_or_default();
        let mut workspaces = store.workspaces()?;
        let first_run = workspaces.is_empty();
        if first_run {
            store.create_workspace(crate::i18n::tr("Mi workspace").as_ref())?;
            workspaces = store.workspaces()?;
        }
        let last: Option<String> = store.setting("workspace");
        let workspace = last.and_then(|id| workspaces.iter().find(|w| w.id == id).cloned()).unwrap_or_else(|| workspaces[0].clone());
        let mut state = Self {
            store,
            workspaces,
            workspace,
            collections: vec![],
            trees: HashMap::new(),
            environments: vec![],
            active_env: None,
            globals: vec![],
            history: vec![],
            settings,
            jar: Arc::new(Mutex::new(CookieJar::new())),
            data_dir: dir,
            servers: vec![],
            sync_status: SyncStatus::Local,
            conflicts: 0,
            presence: vec![],
            mocks: HashMap::new(),
        };
        state.servers = state.store.setting("servers").unwrap_or_default();
        state.load_workspace();
        if first_run {
            crate::sample::create(&state.store, &state.workspace.id);
            state.load_workspace();
        }
        Ok(state)
    }

    fn load_workspace(&mut self) {
        let ws = self.workspace.id.clone();
        self.reload_collections_inner();
        self.environments = self.store.environments(&ws).unwrap_or_default();
        let saved: Option<String> = self.store.setting(&format!("env:{ws}"));
        self.active_env = saved.filter(|id| self.environments.iter().any(|e| &e.id == id));
        self.globals = self.store.globals(&ws).unwrap_or_default();
        self.history = self.store.history(&ws, 300).unwrap_or_default();
        let jar = self.store.cookie_jar(&ws).ok().flatten().map(|j| CookieJar::from_json(&j)).unwrap_or_default();
        self.jar = Arc::new(Mutex::new(jar));
    }

    fn reload_collections_inner(&mut self) {
        let ws = self.workspace.id.clone();
        self.collections = self.store.collections(&ws).unwrap_or_default();
        self.trees = self.collections.iter().filter_map(|c| self.store.collection(&c.id).ok().map(|t| (c.id.clone(), t))).collect();
        self.refresh_mocks();
    }

    // ─────────────────────────── Mock local ───────────────────────────

    /// Colección y variables para el mock (globales < colección < entorno activo).
    fn mock_data(&self, collection: &str) -> Option<crate::mock::MockData> {
        let c = self.trees.get(collection)?;
        let state = self.var_state(Some(c));
        let mut vars = state.globals;
        vars.extend(state.collection);
        vars.extend(state.environment);
        Some(crate::mock::MockData { collection: serde_json::to_value(c).unwrap_or_default(), vars })
    }

    /// Los mocks en marcha responden con lo último guardado.
    fn refresh_mocks(&mut self) {
        let running: Vec<String> = self.mocks.keys().cloned().collect();
        for id in running {
            match self.mock_data(&id) {
                Some(data) => self.mocks[&id].update(data),
                None => {
                    // La colección ya no está (borrada o de otro workspace): se para
                    self.mocks.remove(&id);
                }
            }
        }
    }

    /// Arranca el mock local de una colección y devuelve su URL.
    pub fn start_mock(&mut self, collection: &str, cx: &mut Context<Self>) -> Result<String, String> {
        if let Some(m) = self.mocks.get(collection) {
            return Ok(m.url());
        }
        let data = self.mock_data(collection).ok_or_else(|| "colección no encontrada".to_string())?;
        let first = self.mocks.values().map(|m| m.port + 1).max().unwrap_or(crate::mock::FIRST_PORT).max(crate::mock::FIRST_PORT);
        let mock = crate::mock::start(data, first).map_err(|e| e.to_string())?;
        let url = mock.url();
        self.mocks.insert(collection.to_string(), mock);
        cx.emit(StateEvent::Collections);
        cx.notify();
        Ok(url)
    }

    pub fn stop_mock(&mut self, collection: &str, cx: &mut Context<Self>) {
        if let Some(m) = self.mocks.remove(collection) {
            m.stop();
        }
        cx.emit(StateEvent::Collections);
        cx.notify();
    }

    pub fn reload_collections(&mut self, cx: &mut Context<Self>) {
        self.reload_collections_inner();
        cx.emit(StateEvent::Collections);
        cx.notify();
    }

    pub fn reload_environments(&mut self, cx: &mut Context<Self>) {
        self.environments = self.store.environments(&self.workspace.id).unwrap_or_default();
        if self.active_env.as_ref().is_some_and(|id| !self.environments.iter().any(|e| &e.id == id)) {
            self.active_env = None;
        }
        self.globals = self.store.globals(&self.workspace.id).unwrap_or_default();
        self.refresh_mocks();
        cx.emit(StateEvent::Environments);
        cx.notify();
    }

    pub fn reload_history(&mut self, cx: &mut Context<Self>) {
        self.history = self.store.history(&self.workspace.id, 300).unwrap_or_default();
        cx.emit(StateEvent::History);
        cx.notify();
    }

    pub fn switch_workspace(&mut self, id: &str, cx: &mut Context<Self>) {
        self.save_cookies();
        self.workspaces = self.store.workspaces().unwrap_or_default();
        if let Some(w) = self.workspaces.iter().find(|w| w.id == id).cloned() {
            self.workspace = w;
            let _ = self.store.set_setting("workspace", &id);
            self.load_workspace();
            cx.emit(StateEvent::Workspace);
            cx.notify();
        }
    }

    pub fn refresh_workspaces(&mut self, cx: &mut Context<Self>) {
        self.workspaces = self.store.workspaces().unwrap_or_default();
        if let Some(w) = self.workspaces.iter().find(|w| w.id == self.workspace.id).cloned() {
            self.workspace = w;
        }
        cx.notify();
    }

    pub fn set_active_env(&mut self, id: Option<String>, cx: &mut Context<Self>) {
        self.active_env = id;
        let _ = self.store.set_setting(&format!("env:{}", self.workspace.id), &self.active_env);
        self.refresh_mocks();
        cx.emit(StateEvent::Environments);
        cx.notify();
    }

    pub fn active_environment(&self) -> Option<Environment> {
        self.active_env.as_ref().and_then(|id| self.store.environment(id).ok())
    }

    pub fn save_settings(&mut self, settings: Settings, cx: &mut Context<Self>) {
        self.settings = settings;
        let _ = self.store.set_setting("app", &self.settings);
        cx.emit(StateEvent::Settings);
        cx.notify();
    }

    pub fn save_cookies(&self) {
        if let Ok(jar) = self.jar.try_lock() {
            let _ = self.store.save_cookie_jar(&self.workspace.id, &jar.to_json());
        }
    }

    /// Colección a la que pertenece un ítem (de las cargadas en memoria).
    pub fn collection_of_item(&self, item_id: &str) -> Option<&Collection> {
        self.trees.values().find(|c| cartero_model::tree::find(&c.item, item_id).is_some())
    }

    /// Variables de cada capa, para resolver {{variables}} y mostrar de dónde sale cada una.
    pub fn var_state(&self, collection: Option<&Collection>) -> VarState {
        let env = self.active_environment();
        VarState {
            globals: to_scope(&self.globals),
            collection: collection.map(|c| to_scope(c.variable.as_deref().unwrap_or_default())).unwrap_or_default(),
            environment: env.as_ref().map(|e| to_scope(&e.values)).unwrap_or_default(),
            environment_name: env.map(|e| e.name).unwrap_or_default(),
            data: Scope::new(),
            local: Scope::new(),
        }
    }

    /// Todo lo necesario para enviar `item` (que puede tener cambios sin guardar).
    pub fn run_context(&self, collection_id: Option<&str>, item: &Item) -> RunContext {
        let collection = collection_id.and_then(|id| self.trees.get(id)).cloned().unwrap_or_else(|| {
            let mut c = Collection::new("");
            c.item.push(item.clone());
            c
        });
        RunContext {
            vars: self.var_state(Some(&collection)),
            collection,
            options: self.settings.http_options(),
            jar: self.jar.clone(),
            limits: cartero_script::Limits {
                timeout: std::time::Duration::from_secs(self.settings.script_timeout_s.max(1)),
                ..Default::default()
            },
        }
    }

    /// Guarda en entornos, globales y colección lo que cambiaron los scripts.
    pub fn persist_script_vars(&mut self, before: &VarState, after: &VarState, collection_id: Option<&str>, cx: &mut Context<Self>) {
        if !self.settings.persist_script_variables {
            return;
        }
        let apply = |values: &mut Vec<Variable>, before: &Scope, after: &Scope| -> bool {
            let (changed, removed) = cartero_runner::diff(before, after);
            if changed.is_empty() && removed.is_empty() {
                return false;
            }
            for (k, v) in changed {
                match values.iter_mut().find(|x| x.key == k) {
                    Some(x) => x.value = Some(serde_json::Value::String(v)),
                    None => values.push(Variable::new(k, v)),
                }
            }
            values.retain(|x| !removed.contains(&x.key));
            true
        };
        let mut envs_changed = false;
        if let Some(mut env) = self.active_environment()
            && apply(&mut env.values, &before.environment, &after.environment)
        {
            let _ = self.store.save_environment(&env);
            envs_changed = true;
        }
        let mut globals = self.globals.clone();
        if apply(&mut globals, &before.globals, &after.globals) {
            let _ = self.store.save_globals(&self.workspace.id, &globals);
            self.globals = globals;
            envs_changed = true;
        }
        if let Some(cid) = collection_id
            && let Some(mut c) = self.trees.get(cid).cloned()
        {
            let mut vars = c.variable.clone().unwrap_or_default();
            if apply(&mut vars, &before.collection, &after.collection) {
                c.variable = Some(vars);
                let _ = self.store.save_collection_meta(&c);
                self.trees.insert(cid.to_string(), c);
            }
        }
        if envs_changed {
            cx.emit(StateEvent::Environments);
        }
        cx.notify();
    }
}
