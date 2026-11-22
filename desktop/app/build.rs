//! En Windows, el icono y los datos del ejecutable.
fn main() {
    #[cfg(windows)]
    {
        let mut res = winresource::WindowsResource::new();
        res.set_icon("../packaging/icons/cartero.ico");
        res.set("ProductName", "Cartero");
        res.set("FileDescription", "Cartero");
        let _ = res.compile();
    }
}
