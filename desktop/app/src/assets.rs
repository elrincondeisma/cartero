//! Recursos embebidos: los iconos que usa la app (Lucide) y el logo.

use std::borrow::Cow;

use gpui_kit::{AssetSource, Result, SharedString};

gpui_kit::assets::icon_assets!(pub AppIcons, [
    ArrowUpRight, Box, Braces, Check, ChevronDown, ChevronRight, CircleCheck, CircleX, Clock, Cloud, CloudOff, Code, Cookie, Copy,
    Download, Ellipsis, EllipsisVertical, ExternalLink, Eye, EyeOff, File, FilePlus, FlaskConical, Folder, FolderOpen, FolderPlus,
    Globe, Import, Inbox, Info, Keyboard, Layers, Link, ListChecks, Loader, LoaderCircle, Lock, LogIn, Mail, Minus, Moon, Package,
    PanelLeft, Pencil, Play, Plus, RefreshCw, Rocket, Save, Search, Send, Server, Settings, Square, SquareTerminal, Sun, Terminal,
    Trash, TriangleAlert, Unlink, Upload, Variable, X, Zap,
]);

const LOGO: &[u8] = include_bytes!("../assets/logo.svg");

pub struct Assets;

impl AssetSource for Assets {
    fn load(&self, path: &str) -> Result<Option<Cow<'static, [u8]>>> {
        if path == "cartero/logo.svg" {
            return Ok(Some(Cow::Borrowed(LOGO)));
        }
        if let Some(found) = AppIcons.load(path)? {
            return Ok(Some(found));
        }
        gpui_kit::assets::Assets.load(path)
    }

    fn list(&self, path: &str) -> Result<Vec<SharedString>> {
        let mut out = AppIcons.list(path)?;
        out.extend(gpui_kit::assets::Assets.list(path)?);
        Ok(out)
    }
}
