//! Fragmentos de código para repetir una petición fuera de Cartero.

use crate::prepare::{FormPart, Prepared, PreparedBody};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Language {
    Curl,
    Httpie,
    Fetch,
    Axios,
    PythonRequests,
    Go,
    Php,
    CSharp,
    PowerShell,
}

impl Language {
    pub const ALL: [Language; 9] = [
        Language::Curl,
        Language::Httpie,
        Language::Fetch,
        Language::Axios,
        Language::PythonRequests,
        Language::Go,
        Language::Php,
        Language::CSharp,
        Language::PowerShell,
    ];
    pub fn label(self) -> &'static str {
        match self {
            Language::Curl => "cURL",
            Language::Httpie => "HTTPie",
            Language::Fetch => "JavaScript · fetch",
            Language::Axios => "Node.js · axios",
            Language::PythonRequests => "Python · requests",
            Language::Go => "Go · net/http",
            Language::Php => "PHP · cURL",
            Language::CSharp => "C# · HttpClient",
            Language::PowerShell => "PowerShell",
        }
    }
    /// Lenguaje para el resaltado del editor
    pub fn syntax(self) -> &'static str {
        match self {
            Language::Curl | Language::Httpie => "bash",
            Language::Fetch | Language::Axios => "javascript",
            Language::PythonRequests => "python",
            Language::Go => "go",
            Language::Php => "php",
            Language::CSharp => "csharp",
            Language::PowerShell => "powershell",
        }
    }
}

fn sh(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

fn js(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_default()
}

pub fn generate(lang: Language, p: &Prepared) -> String {
    match lang {
        Language::Curl => curl(p),
        Language::Httpie => httpie(p),
        Language::Fetch => fetch(p),
        Language::Axios => axios(p),
        Language::PythonRequests => python(p),
        Language::Go => go(p),
        Language::Php => php(p),
        Language::CSharp => csharp(p),
        Language::PowerShell => powershell(p),
    }
}

fn urlencode(pairs: &[(String, String)]) -> String {
    let enc = |s: &str| percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string();
    pairs.iter().map(|(k, v)| format!("{}={}", enc(k), enc(v))).collect::<Vec<_>>().join("&")
}

/// Cabeceras sin Content-Type cuando lo pone la librería (multipart)
fn headers_for(p: &Prepared) -> Vec<(String, String)> {
    let multipart = matches!(p.body, PreparedBody::FormData(_));
    p.headers.iter().filter(|(k, _)| !(multipart && k.eq_ignore_ascii_case("content-type"))).cloned().collect()
}

fn curl(p: &Prepared) -> String {
    let mut parts = vec![format!("curl --location --request {} {}", p.method, sh(&p.url))];
    for (k, v) in headers_for(p) {
        parts.push(format!("--header {}", sh(&format!("{k}: {v}"))));
    }
    match &p.body {
        PreparedBody::Raw(s) => parts.push(format!("--data-raw {}", sh(s))),
        PreparedBody::UrlEncoded(list) => {
            for (k, v) in list {
                parts.push(format!("--data-urlencode {}", sh(&format!("{k}={v}"))));
            }
        }
        PreparedBody::FormData(list) => {
            for f in list {
                match f {
                    FormPart::Text { key, value, .. } => parts.push(format!("--form {}", sh(&format!("{key}={value}")))),
                    FormPart::File { key, path, .. } => parts.push(format!("--form {}", sh(&format!("{key}=@\"{path}\"")))),
                }
            }
        }
        PreparedBody::File(path) => parts.push(format!("--data-binary {}", sh(&format!("@{path}")))),
        PreparedBody::None => {}
    }
    parts.join(" \\\n  ")
}

fn httpie(p: &Prepared) -> String {
    let mut out = String::new();
    match &p.body {
        PreparedBody::Raw(s) => out.push_str(&format!("printf %s {} | ", sh(s))),
        PreparedBody::File(path) => out.push_str(&format!("cat {} | ", sh(path))),
        _ => {}
    }
    let flag = match &p.body {
        PreparedBody::UrlEncoded(_) => " --form",
        PreparedBody::FormData(_) => " --multipart",
        _ => "",
    };
    out.push_str(&format!("http{flag} {} {}", p.method, sh(&p.url)));
    for (k, v) in headers_for(p) {
        out.push_str(&format!(" \\\n  {}", sh(&format!("{k}:{v}"))));
    }
    match &p.body {
        PreparedBody::UrlEncoded(list) => {
            for (k, v) in list {
                out.push_str(&format!(" \\\n  {}", sh(&format!("{k}={v}"))));
            }
        }
        PreparedBody::FormData(list) => {
            for f in list {
                match f {
                    FormPart::Text { key, value, .. } => out.push_str(&format!(" \\\n  {}", sh(&format!("{key}={value}")))),
                    FormPart::File { key, path, .. } => out.push_str(&format!(" \\\n  {}", sh(&format!("{key}@{path}")))),
                }
            }
        }
        _ => {}
    }
    out
}

fn js_headers(p: &Prepared, indent: &str) -> String {
    let hs = headers_for(p);
    if hs.is_empty() {
        return "{}".into();
    }
    let lines: Vec<String> = hs.iter().map(|(k, v)| format!("{indent}  {}: {}", js(k), js(v))).collect();
    format!("{{\n{}\n{indent}}}", lines.join(",\n"))
}

fn js_body_setup(p: &Prepared) -> (String, Option<String>) {
    match &p.body {
        PreparedBody::Raw(s) => (String::new(), Some(js(s))),
        PreparedBody::UrlEncoded(list) => {
            let mut setup = "const body = new URLSearchParams()\n".to_string();
            for (k, v) in list {
                setup.push_str(&format!("body.append({}, {})\n", js(k), js(v)));
            }
            (setup + "\n", Some("body".into()))
        }
        PreparedBody::FormData(list) => {
            let mut setup = "const body = new FormData()\n".to_string();
            for f in list {
                match f {
                    FormPart::Text { key, value, .. } => setup.push_str(&format!("body.append({}, {})\n", js(key), js(value))),
                    FormPart::File { key, path, .. } => {
                        setup.push_str(&format!("body.append({}, fileInput.files[0], {}) // {path}\n", js(key), js(path)))
                    }
                }
            }
            (setup + "\n", Some("body".into()))
        }
        PreparedBody::File(path) => (format!("// Cuerpo binario: {path}\nconst body = fileInput.files[0]\n\n"), Some("body".into())),
        PreparedBody::None => (String::new(), None),
    }
}

fn fetch(p: &Prepared) -> String {
    let (setup, body) = js_body_setup(p);
    let mut opts = vec![format!("  method: {}", js(&p.method)), format!("  headers: {}", js_headers(p, "  "))];
    if let Some(b) = body {
        opts.push(format!("  body: {b}"));
    }
    format!(
        "{setup}const response = await fetch({}, {{\n{},\n}})\nconsole.log(response.status, await response.text())",
        js(&p.url),
        opts.join(",\n")
    )
}

fn axios(p: &Prepared) -> String {
    let (setup, body) = js_body_setup(p);
    let mut opts = vec![
        format!("  method: {}", js(&p.method.to_lowercase())),
        format!("  url: {}", js(&p.url)),
        format!("  headers: {}", js_headers(p, "  ")),
    ];
    if let Some(b) = body {
        opts.push(format!("  data: {b}"));
    }
    format!(
        "import axios from 'axios'\n\n{setup}const response = await axios({{\n{},\n}})\nconsole.log(response.status, response.data)",
        opts.join(",\n")
    )
}

fn py(s: &str) -> String {
    // Las cadenas JSON valen también como cadenas de Python
    js(s)
}

fn python(p: &Prepared) -> String {
    let mut out = "import requests\n\n".to_string();
    out.push_str(&format!("url = {}\n", py(&p.url)));
    let hs = headers_for(p);
    let hs_lines: Vec<String> = hs.iter().map(|(k, v)| format!("    {}: {},", py(k), py(v))).collect();
    out.push_str(&format!("headers = {{\n{}\n}}\n", hs_lines.join("\n")));
    let mut args = vec!["url".to_string(), "headers=headers".into()];
    match &p.body {
        PreparedBody::Raw(s) => {
            out.push_str(&format!("data = {}\n", py(s)));
            args.push("data=data.encode()".into());
        }
        PreparedBody::UrlEncoded(list) => {
            let lines: Vec<String> = list.iter().map(|(k, v)| format!("    ({}, {}),", py(k), py(v))).collect();
            out.push_str(&format!("data = [\n{}\n]\n", lines.join("\n")));
            args.push("data=data".into());
        }
        PreparedBody::FormData(list) => {
            let mut data = vec![];
            let mut files = vec![];
            for f in list {
                match f {
                    FormPart::Text { key, value, .. } => data.push(format!("    ({}, {}),", py(key), py(value))),
                    FormPart::File { key, path, .. } => files.push(format!("    ({}, open({}, \"rb\")),", py(key), py(path))),
                }
            }
            out.push_str(&format!("data = [\n{}\n]\nfiles = [\n{}\n]\n", data.join("\n"), files.join("\n")));
            args.push("data=data".into());
            args.push("files=files".into());
        }
        PreparedBody::File(path) => {
            out.push_str(&format!("data = open({}, \"rb\")\n", py(path)));
            args.push("data=data".into());
        }
        PreparedBody::None => {}
    }
    out.push_str(&format!(
        "\nresponse = requests.request({}, {})\nprint(response.status_code, response.text)\n",
        py(&p.method),
        args.join(", ")
    ));
    out
}

fn go(p: &Prepared) -> String {
    let goq = |s: &str| js(s);
    let mut imports = vec!["\"fmt\"", "\"io\"", "\"net/http\""];
    let mut setup = String::new();
    let body_expr = match &p.body {
        PreparedBody::Raw(s) => {
            imports.push("\"strings\"");
            format!("strings.NewReader({})", goq(s))
        }
        PreparedBody::UrlEncoded(list) => {
            imports.push("\"strings\"");
            format!("strings.NewReader({})", goq(&urlencode(list)))
        }
        PreparedBody::FormData(list) => {
            imports.extend(["\"bytes\"", "\"mime/multipart\"", "\"os\""]);
            setup.push_str("\tbody := &bytes.Buffer{}\n\tw := multipart.NewWriter(body)\n");
            for f in list {
                match f {
                    FormPart::Text { key, value, .. } => setup.push_str(&format!("\tw.WriteField({}, {})\n", goq(key), goq(value))),
                    FormPart::File { key, path, .. } => setup.push_str(&format!(
                        "\tif f, err := os.Open({0}); err == nil {{\n\t\tpart, _ := w.CreateFormFile({1}, f.Name())\n\t\tio.Copy(part, f)\n\t\tf.Close()\n\t}}\n",
                        goq(path),
                        goq(key)
                    )),
                }
            }
            setup.push_str("\tw.Close()\n");
            "body".into()
        }
        PreparedBody::File(path) => {
            imports.push("\"os\"");
            setup.push_str(&format!("\tbody, _ := os.Open({})\n", goq(path)));
            "body".into()
        }
        PreparedBody::None => "nil".into(),
    };
    imports.sort();
    let mut out = format!("package main\n\nimport (\n\t{}\n)\n\nfunc main() {{\n{setup}", imports.join("\n\t"));
    out.push_str(&format!(
        "\treq, err := http.NewRequest({}, {}, {body_expr})\n\tif err != nil {{\n\t\tpanic(err)\n\t}}\n",
        goq(&p.method),
        goq(&p.url)
    ));
    for (k, v) in headers_for(p) {
        out.push_str(&format!("\treq.Header.Set({}, {})\n", goq(&k), goq(&v)));
    }
    if matches!(p.body, PreparedBody::FormData(_)) {
        out.push_str("\treq.Header.Set(\"Content-Type\", w.FormDataContentType())\n");
    }
    out.push_str("\tres, err := http.DefaultClient.Do(req)\n\tif err != nil {\n\t\tpanic(err)\n\t}\n\tdefer res.Body.Close()\n\tdata, _ := io.ReadAll(res.Body)\n\tfmt.Println(res.StatusCode, string(data))\n}\n");
    out
}

fn php(p: &Prepared) -> String {
    let q = |s: &str| format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'"));
    let mut opts = vec![
        format!("    CURLOPT_URL => {}", q(&p.url)),
        "    CURLOPT_RETURNTRANSFER => true".into(),
        "    CURLOPT_FOLLOWLOCATION => true".into(),
        format!("    CURLOPT_CUSTOMREQUEST => {}", q(&p.method)),
    ];
    match &p.body {
        PreparedBody::Raw(s) => opts.push(format!("    CURLOPT_POSTFIELDS => {}", q(s))),
        PreparedBody::UrlEncoded(list) => opts.push(format!("    CURLOPT_POSTFIELDS => {}", q(&urlencode(list)))),
        PreparedBody::FormData(list) => {
            let fields: Vec<String> = list
                .iter()
                .map(|f| match f {
                    FormPart::Text { key, value, .. } => format!("        {} => {}", q(key), q(value)),
                    FormPart::File { key, path, .. } => format!("        {} => new CURLFile({})", q(key), q(path)),
                })
                .collect();
            opts.push(format!("    CURLOPT_POSTFIELDS => [\n{}\n    ]", fields.join(",\n")));
        }
        PreparedBody::File(path) => opts.push(format!("    CURLOPT_POSTFIELDS => file_get_contents({})", q(path))),
        PreparedBody::None => {}
    }
    let hs = headers_for(p);
    if !hs.is_empty() {
        let lines: Vec<String> = hs.iter().map(|(k, v)| format!("        {}", q(&format!("{k}: {v}")))).collect();
        opts.push(format!("    CURLOPT_HTTPHEADER => [\n{}\n    ]", lines.join(",\n")));
    }
    format!(
        "<?php\n$curl = curl_init();\ncurl_setopt_array($curl, [\n{},\n]);\n$response = curl_exec($curl);\necho curl_getinfo($curl, CURLINFO_HTTP_CODE) . \"\\n\" . $response;\ncurl_close($curl);\n",
        opts.join(",\n")
    )
}

fn csharp(p: &Prepared) -> String {
    let q = |s: &str| js(s);
    let mut out = format!(
        "using var client = new HttpClient();\nvar request = new HttpRequestMessage(new HttpMethod({}), {});\n",
        q(&p.method),
        q(&p.url)
    );
    let ct = p.header("content-type").unwrap_or("text/plain").to_string();
    for (k, v) in headers_for(p).iter().filter(|(k, _)| !k.eq_ignore_ascii_case("content-type")) {
        out.push_str(&format!("request.Headers.TryAddWithoutValidation({}, {});\n", q(k), q(v)));
    }
    match &p.body {
        PreparedBody::Raw(s) => {
            let media = ct.split(';').next().unwrap_or("text/plain").trim().to_string();
            out.push_str(&format!("request.Content = new StringContent({}, System.Text.Encoding.UTF8, {});\n", q(s), q(&media)));
        }
        PreparedBody::UrlEncoded(list) => {
            let pairs: Vec<String> = list.iter().map(|(k, v)| format!("    new({}, {})", q(k), q(v))).collect();
            out.push_str(&format!(
                "request.Content = new FormUrlEncodedContent(new KeyValuePair<string, string>[] {{\n{}\n}});\n",
                pairs.join(",\n")
            ));
        }
        PreparedBody::FormData(list) => {
            out.push_str("var form = new MultipartFormDataContent();\n");
            for f in list {
                match f {
                    FormPart::Text { key, value, .. } => out.push_str(&format!("form.Add(new StringContent({}), {});\n", q(value), q(key))),
                    FormPart::File { key, path, .. } => out.push_str(&format!(
                        "form.Add(new StreamContent(File.OpenRead({})), {}, Path.GetFileName({}));\n",
                        q(path),
                        q(key),
                        q(path)
                    )),
                }
            }
            out.push_str("request.Content = form;\n");
        }
        PreparedBody::File(path) => out.push_str(&format!("request.Content = new StreamContent(File.OpenRead({}));\n", q(path))),
        PreparedBody::None => {}
    }
    out.push_str("var response = await client.SendAsync(request);\nConsole.WriteLine((int)response.StatusCode);\nConsole.WriteLine(await response.Content.ReadAsStringAsync());\n");
    out
}

fn powershell(p: &Prepared) -> String {
    let q = |s: &str| format!("'{}'", s.replace('\'', "''"));
    let mut out = String::new();
    let hs: Vec<(String, String)> = headers_for(p).into_iter().filter(|(k, _)| !k.eq_ignore_ascii_case("content-type")).collect();
    if !hs.is_empty() {
        out.push_str("$headers = @{\n");
        for (k, v) in &hs {
            out.push_str(&format!("    {} = {}\n", q(k), q(v)));
        }
        out.push_str("}\n");
    }
    let mut args = vec![format!("-Uri {}", q(&p.url)), format!("-Method {}", p.method)];
    if !hs.is_empty() {
        args.push("-Headers $headers".into());
    }
    match &p.body {
        PreparedBody::Raw(s) => {
            out.push_str(&format!("$body = {}\n", q(s)));
            args.push("-Body $body".into());
            if let Some(ct) = p.header("content-type") {
                args.push(format!("-ContentType {}", q(ct)));
            }
        }
        PreparedBody::UrlEncoded(list) => {
            out.push_str("$body = @{\n");
            for (k, v) in list {
                out.push_str(&format!("    {} = {}\n", q(k), q(v)));
            }
            out.push_str("}\n");
            args.push("-Body $body".into());
        }
        PreparedBody::FormData(list) => {
            out.push_str("$form = @{\n");
            for f in list {
                match f {
                    FormPart::Text { key, value, .. } => out.push_str(&format!("    {} = {}\n", q(key), q(value))),
                    FormPart::File { key, path, .. } => out.push_str(&format!("    {} = Get-Item -Path {}\n", q(key), q(path))),
                }
            }
            out.push_str("}\n");
            args.push("-Form $form".into());
        }
        PreparedBody::File(path) => args.push(format!("-InFile {}", q(path))),
        PreparedBody::None => {}
    }
    out.push_str(&format!("$response = Invoke-WebRequest {}\n$response.StatusCode\n$response.Content\n", args.join(" ")));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Prepared {
        Prepared {
            method: "POST".into(),
            url: "https://api.io/items?x=1".into(),
            headers: vec![("Content-Type".into(), "application/json".into()), ("X-Q".into(), "it's".into())],
            body: PreparedBody::Raw("{\"a\":\"b\"}".into()),
            auth: None,
        }
    }

    #[test]
    fn curl_se_puede_volver_a_importar() {
        let code = generate(Language::Curl, &sample());
        let back = crate::import::curl::parse(&code).unwrap();
        assert_eq!(back.method, "POST");
        assert_eq!(back.url.raw(), "https://api.io/items?x=1");
        assert_eq!(back.headers()[1].value, "it's");
        assert_eq!(back.body.unwrap().raw.as_deref(), Some("{\"a\":\"b\"}"));
    }

    #[test]
    fn todos_los_lenguajes_generan_algo() {
        let mut form = sample();
        form.body = PreparedBody::FormData(vec![
            FormPart::Text { key: "t".into(), value: "v".into(), content_type: None },
            FormPart::File { key: "f".into(), path: "/tmp/a.png".into(), content_type: None },
        ]);
        for lang in Language::ALL {
            for p in [sample(), form.clone()] {
                let code = generate(lang, &p);
                assert!(code.contains("api.io/items"), "{lang:?}: {code}");
            }
        }
        assert!(generate(Language::PythonRequests, &form).contains("open(\"/tmp/a.png\", \"rb\")"));
    }
}
