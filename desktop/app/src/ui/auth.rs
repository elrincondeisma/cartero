//! Editor de autenticación: el tipo y sus campos. Las peticiones y carpetas pueden heredar.

use std::collections::HashMap;

use cartero_model::Auth;
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::checkbox::Checkbox;
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::notification::Notification;

use crate::state::AppState;
use crate::ui::prelude::*;
use crate::ui::widgets::choice;

#[derive(Clone, Copy)]
enum Kind {
    Text,
    Secret,
    Choice(&'static [(&'static str, &'static str)]),
    Bool(bool),
}

struct Field {
    key: &'static str,
    label: &'static str,
    placeholder: &'static str,
    kind: Kind,
}

const fn f(key: &'static str, label: &'static str, placeholder: &'static str, kind: Kind) -> Field {
    Field { key, label, placeholder, kind }
}

fn fields(kind: &str) -> Vec<Field> {
    match kind {
        "basic" => vec![f("username", "Usuario", "", Kind::Text), f("password", "Contraseña", "", Kind::Secret)],
        "bearer" => vec![f("token", "Token", "", Kind::Secret)],
        "apikey" => vec![
            f("key", "Nombre", "X-API-Key", Kind::Text),
            f("value", "Valor", "", Kind::Secret),
            f("in", "Dónde se envía", "", Kind::Choice(&[("header", "Cabecera"), ("query", "Parámetro de la URL")])),
        ],
        "digest" => vec![f("username", "Usuario", "", Kind::Text), f("password", "Contraseña", "", Kind::Secret)],
        "oauth1" => vec![
            f("consumerKey", "Consumer key", "", Kind::Text),
            f("consumerSecret", "Consumer secret", "", Kind::Secret),
            f("token", "Token de acceso", "", Kind::Text),
            f("tokenSecret", "Secreto del token", "", Kind::Secret),
            f(
                "signatureMethod",
                "Método de firma",
                "",
                Kind::Choice(&[("HMAC-SHA1", "HMAC-SHA1"), ("HMAC-SHA256", "HMAC-SHA256"), ("PLAINTEXT", "PLAINTEXT")]),
            ),
            f("realm", "Realm", "", Kind::Text),
            f("addParamsToHeader", "Enviar los parámetros en la cabecera Authorization", "", Kind::Bool(true)),
        ],
        "oauth2" => vec![
            f("accessToken", "Token de acceso", "", Kind::Secret),
            f("headerPrefix", "Prefijo de la cabecera", "Bearer", Kind::Text),
            f("addTokenTo", "Dónde se envía", "", Kind::Choice(&[("header", "Cabecera"), ("queryParams", "Parámetro de la URL")])),
            f(
                "grant_type",
                "Tipo de concesión",
                "",
                Kind::Choice(&[
                    ("authorization_code", "Código de autorización (con PKCE)"),
                    ("client_credentials", "Credenciales de cliente"),
                    ("password", "Usuario y contraseña"),
                ]),
            ),
            f("authUrl", "URL de autorización", "https://…/authorize", Kind::Text),
            f("accessTokenUrl", "URL del token", "https://…/token", Kind::Text),
            f("clientId", "Client ID", "", Kind::Text),
            f("clientSecret", "Client secret", "", Kind::Secret),
            f("scope", "Scope", "read write", Kind::Text),
            f("username", "Usuario", "", Kind::Text),
            f("password", "Contraseña", "", Kind::Secret),
            f("redirect_uri", "URL de redirección", crate::oauth2::DEFAULT_CALLBACK, Kind::Text),
            f(
                "client_authentication",
                "Credenciales del cliente",
                "",
                Kind::Choice(&[("header", "En la cabecera (Basic)"), ("body", "En el cuerpo")]),
            ),
        ],
        "awsv4" => vec![
            f("accessKey", "Access key", "", Kind::Text),
            f("secretKey", "Secret key", "", Kind::Secret),
            f("region", "Región", "us-east-1", Kind::Text),
            f("service", "Servicio", "execute-api", Kind::Text),
            f("sessionToken", "Token de sesión", "", Kind::Secret),
        ],
        "hawk" => vec![
            f("authId", "Hawk Auth ID", "", Kind::Text),
            f("authKey", "Hawk Auth Key", "", Kind::Secret),
            f("algorithm", "Algoritmo", "", Kind::Choice(&[("sha256", "SHA-256"), ("sha1", "SHA-1")])),
            f("user", "Usuario", "", Kind::Text),
            f("extraData", "Datos extra (ext)", "", Kind::Text),
            f("app", "App", "", Kind::Text),
            f("delegation", "Delegación (dlg)", "", Kind::Text),
            f("includePayloadHash", "Incluir el hash del cuerpo", "", Kind::Bool(false)),
        ],
        _ => vec![],
    }
}

/// Campos que solo aplican a un tipo de concesión de OAuth 2.0.
fn oauth2_visible(key: &str, grant: &str) -> bool {
    match key {
        "authUrl" | "redirect_uri" => grant == "authorization_code",
        "username" | "password" => grant == "password",
        _ => true,
    }
}

pub fn kinds(inherit: bool) -> Vec<(SharedString, String)> {
    let mut out = vec![];
    if inherit {
        out.push((tr("Heredar"), "inherit".to_string()));
    }
    out.extend([
        (tr("Sin autenticación"), "noauth".to_string()),
        ("Basic".into(), "basic".to_string()),
        ("Bearer token".into(), "bearer".to_string()),
        ("API key".into(), "apikey".to_string()),
        ("Digest".into(), "digest".to_string()),
        ("OAuth 1.0".into(), "oauth1".to_string()),
        ("OAuth 2.0".into(), "oauth2".to_string()),
        ("AWS Signature v4".into(), "awsv4".to_string()),
        ("Hawk".into(), "hawk".to_string()),
    ]);
    out
}

pub struct AuthChanged;

pub struct AuthEditor {
    app: Entity<AppState>,
    collection_id: Option<String>,
    /// Lo que había, para no perder atributos que no editamos
    base: Option<Auth>,
    kind: String,
    allow_inherit: bool,
    inputs: HashMap<&'static str, Entity<InputState>>,
    flags: HashMap<&'static str, String>,
    /// Origen de la auth heredada («Bearer token de «API»»)
    inherited: Option<SharedString>,
    fetching: bool,
    _subs: Vec<Subscription>,
}

impl EventEmitter<AuthChanged> for AuthEditor {}

impl AuthEditor {
    /// `auth`: None = hereda (o sin auth si no se puede heredar).
    pub fn new(
        app: Entity<AppState>,
        collection_id: Option<String>,
        auth: Option<Auth>,
        allow_inherit: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let mut this = Self {
            app,
            collection_id,
            base: None,
            kind: String::new(),
            allow_inherit,
            inputs: HashMap::new(),
            flags: HashMap::new(),
            inherited: None,
            fetching: false,
            _subs: vec![],
        };
        this.load(auth, window, cx);
        this
    }

    pub fn set_inherited(&mut self, from: Option<SharedString>, cx: &mut Context<Self>) {
        self.inherited = from;
        cx.notify();
    }

    pub fn load(&mut self, auth: Option<Auth>, window: &mut Window, cx: &mut Context<Self>) {
        self.kind = match &auth {
            Some(a) => a.kind.clone(),
            None if self.allow_inherit => "inherit".into(),
            None => "noauth".into(),
        };
        self.base = auth;
        self.build_fields(window, cx);
    }

    fn build_fields(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.inputs.clear();
        self.flags.clear();
        self._subs.clear();
        let base = self.base.clone().filter(|a| a.kind == self.kind);
        for field in fields(&self.kind) {
            let current = base.as_ref().and_then(|a| a.get(field.key));
            match field.kind {
                Kind::Text | Kind::Secret => {
                    let masked = matches!(field.kind, Kind::Secret);
                    let state = cx.new(|cx| {
                        let s = InputState::new(window, cx).placeholder(field.placeholder).default_value(current.unwrap_or_default());
                        if masked { s.masked(true) } else { s }
                    });
                    self._subs.push(cx.subscribe_in(&state, window, |_, _, ev: &InputEvent, _, cx| {
                        if matches!(ev, InputEvent::Change) {
                            cx.emit(AuthChanged);
                        }
                    }));
                    self.inputs.insert(field.key, state);
                }
                Kind::Choice(opts) => {
                    self.flags.insert(field.key, current.filter(|c| !c.is_empty()).unwrap_or_else(|| opts[0].0.to_string()));
                }
                Kind::Bool(default) => {
                    let v = current.map(|c| c == "true").unwrap_or(default);
                    self.flags.insert(field.key, v.to_string());
                }
            }
        }
        cx.notify();
    }

    fn set_kind(&mut self, kind: String, window: &mut Window, cx: &mut Context<Self>) {
        if kind == self.kind {
            return;
        }
        // Al cambiar de tipo conservamos lo escrito por si vuelve
        if let Some(a) = self.value(cx) {
            self.base = Some(a);
        }
        self.kind = kind;
        self.build_fields(window, cx);
        cx.emit(AuthChanged);
    }

    /// La auth editada. None = heredar.
    pub fn value(&self, cx: &App) -> Option<Auth> {
        if self.kind == "inherit" {
            return None;
        }
        let mut a = self.base.clone().filter(|a| a.kind == self.kind).unwrap_or_else(|| Auth::new(&self.kind));
        for (k, input) in &self.inputs {
            a.set(k, input.read(cx).value().to_string());
        }
        for (k, v) in &self.flags {
            a.set(k, v.clone());
        }
        Some(a)
    }

    fn resolved_params(&self, cx: &App) -> HashMap<String, String> {
        let app = self.app.read(cx);
        let collection = self.collection_id.as_ref().and_then(|id| app.trees.get(id));
        let layers = app.var_state(collection).layers();
        let mut out = HashMap::new();
        for (k, input) in &self.inputs {
            out.insert(k.to_string(), layers.resolve(input.read(cx).value().as_ref()));
        }
        for (k, v) in &self.flags {
            out.insert(k.to_string(), v.clone());
        }
        out
    }

    fn get_token(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let params = self.resolved_params(cx);
        let opts = self.app.read(cx).settings.http_options();
        self.fetching = true;
        cx.notify();
        let task = crate::runtime::spawn(crate::oauth2::fetch_token(params, opts, |url| {
            let _ = open::that(url);
        }));
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await.unwrap_or_else(|e| Err(e.to_string()));
            let _ = this.update_in(cx, |this, window, cx| {
                this.fetching = false;
                match result {
                    Ok(token) => {
                        if let Some(input) = this.inputs.get("accessToken") {
                            input.update(cx, |s, cx| s.set_value(token.access_token.clone(), window, cx));
                        }
                        if let Some(t) = token.token_type.filter(|t| !t.eq_ignore_ascii_case("bearer"))
                            && let Some(input) = this.inputs.get("headerPrefix")
                        {
                            input.update(cx, |s, cx| s.set_value(t, window, cx));
                        }
                        if let Some(r) = token.refresh_token {
                            let mut base = this.value(cx).unwrap_or_else(|| Auth::new("oauth2"));
                            base.set("refreshToken", r);
                            this.base = Some(base);
                        }
                        cx.emit(AuthChanged);
                        window.push_notification(Notification::success(tr("Token obtenido")), cx);
                    }
                    Err(e) => window.push_notification(Notification::error(e).title(tr("No se pudo obtener el token")), cx),
                }
                cx.notify();
            });
        })
        .detach();
    }
}

impl Render for AuthEditor {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let entity = cx.entity();
        let muted = cx.theme().muted_foreground;
        let kind_picker = choice("auth-kind", &self.kind, kinds(self.allow_inherit), {
            let entity = entity.clone();
            move |k, window, cx| entity.update(cx, |this, cx| this.set_kind(k, window, cx))
        });
        let help: Option<SharedString> = match self.kind.as_str() {
            "inherit" => Some(match &self.inherited {
                Some(from) => trf("Se usa la autenticación de {from}.", &[("from", from)]),
                None => tr("La carpeta y la colección no tienen autenticación: la petición se envía sin ella."),
            }),
            "noauth" => Some(tr("La petición se envía sin autenticación.")),
            "digest" => Some(tr("Cartero responde al reto del servidor (401) y repite la petición automáticamente.")),
            "oauth1" | "awsv4" | "hawk" => Some(tr("La firma se calcula al enviar, con la URL, las cabeceras y el cuerpo definitivos.")),
            _ => None,
        };
        let grant = self.flags.get("grant_type").cloned().unwrap_or_default();
        let rows = fields(&self.kind).into_iter().filter(|fl| self.kind != "oauth2" || oauth2_visible(fl.key, &grant)).map(|field| {
            let key = field.key;
            let control: AnyElement = match field.kind {
                Kind::Text | Kind::Secret => match self.inputs.get(key) {
                    Some(input) => {
                        Input::new(input).small().when(matches!(field.kind, Kind::Secret), |i| i.mask_toggle()).into_any_element()
                    }
                    None => div().into_any_element(),
                },
                Kind::Choice(opts) => {
                    let current = self.flags.get(key).cloned().unwrap_or_default();
                    let options: Vec<(SharedString, String)> = opts.iter().map(|(v, l)| (tr_static(l), v.to_string())).collect();
                    let entity = entity.clone();
                    div()
                        .child(choice(SharedString::from(format!("auth-{key}")), &current, options, move |v, _, cx| {
                            entity.update(cx, |this, cx| {
                                this.flags.insert(key, v);
                                cx.emit(AuthChanged);
                                cx.notify();
                            })
                        }))
                        .into_any_element()
                }
                Kind::Bool(_) => {
                    let checked = self.flags.get(key).is_some_and(|v| v == "true");
                    let entity = entity.clone();
                    Checkbox::new(SharedString::from(format!("auth-{key}")))
                        .checked(checked)
                        .label(tr_static(field.label))
                        .on_click(move |c, _, cx| {
                            let c = *c;
                            entity.update(cx, |this, cx| {
                                this.flags.insert(key, c.to_string());
                                cx.emit(AuthChanged);
                                cx.notify();
                            })
                        })
                        .into_any_element()
                }
            };
            let label = if matches!(field.kind, Kind::Bool(_)) { SharedString::default() } else { tr_static(field.label) };
            div()
                .h_flex()
                .gap_3()
                .child(div().w(px(180.)).flex_none().text_sm().text_color(muted).child(label))
                .child(div().flex_1().max_w(px(520.)).child(control))
        });
        div()
            .v_flex()
            .gap_3()
            .p_3()
            .child(div().h_flex().gap_3().child(div().w(px(180.)).text_sm().text_color(muted).child(tr("Tipo"))).child(kind_picker))
            .when_some(help, |d, h| d.child(div().text_sm().text_color(muted).child(h)))
            .children(rows)
            .when(self.kind == "oauth2", |d| {
                d.child(
                    div().h_flex().gap_3().child(div().w(px(180.))).child(
                        Button::new("oauth2-get")
                            .primary()
                            .small()
                            .icon(IconName::LogIn)
                            .label(tr("Obtener un token nuevo"))
                            .loading(self.fetching)
                            .on_click(cx.listener(|this, _, window, cx| this.get_token(window, cx))),
                    ),
                )
            })
    }
}

/// Traduce etiquetas guardadas en tablas estáticas (también se comprueban en el test de idiomas).
fn tr_static(s: &'static str) -> SharedString {
    crate::i18n::tr(s)
}
