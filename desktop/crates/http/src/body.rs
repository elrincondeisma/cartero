//! Cuerpo de la petición en bytes: raw, urlencoded, multipart y binario.

use cartero_model::prepare::{FormPart, Prepared, PreparedBody};

use crate::HttpError;

const FORM: &percent_encoding::AsciiSet =
    &percent_encoding::NON_ALPHANUMERIC.remove(b'-').remove(b'_').remove(b'.').remove(b'~').remove(b'*');

pub fn urlencode(pairs: &[(String, String)]) -> String {
    let enc = |s: &str| percent_encoding::utf8_percent_encode(s, FORM).to_string().replace("%20", "+");
    pairs.iter().map(|(k, v)| format!("{}={}", enc(k), enc(v))).collect::<Vec<_>>().join("&")
}

/// Construye el cuerpo y, si hace falta, el Content-Type (multipart lleva el boundary).
pub fn build(p: &Prepared) -> Result<(Vec<u8>, Option<String>), HttpError> {
    Ok(match &p.body {
        PreparedBody::None => (vec![], None),
        PreparedBody::Raw(s) => (s.as_bytes().to_vec(), None),
        PreparedBody::UrlEncoded(list) => (urlencode(list).into_bytes(), None),
        PreparedBody::File(path) => {
            let data = std::fs::read(path).map_err(|e| HttpError::Body(format!("no se puede leer {path}: {e}")))?;
            let ct = p.header("content-type").is_none().then(|| mime_guess::from_path(path).first_or_octet_stream().to_string());
            (data, ct)
        }
        PreparedBody::FormData(parts) => {
            let boundary = format!("----CarteroFormBoundary{:016x}", rand::random::<u64>());
            let mut out = Vec::new();
            for part in parts {
                out.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
                match part {
                    FormPart::Text { key, value, content_type } => {
                        out.extend_from_slice(format!("Content-Disposition: form-data; name=\"{}\"\r\n", escape(key)).as_bytes());
                        if let Some(ct) = content_type.as_deref().filter(|c| !c.is_empty()) {
                            out.extend_from_slice(format!("Content-Type: {ct}\r\n").as_bytes());
                        }
                        out.extend_from_slice(b"\r\n");
                        out.extend_from_slice(value.as_bytes());
                    }
                    FormPart::File { key, path, content_type } => {
                        let data = std::fs::read(path).map_err(|e| HttpError::Body(format!("no se puede leer {path}: {e}")))?;
                        let name = std::path::Path::new(path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                        let ct = content_type
                            .clone()
                            .filter(|c| !c.is_empty())
                            .unwrap_or_else(|| mime_guess::from_path(path).first_or_octet_stream().to_string());
                        out.extend_from_slice(
                            format!(
                                "Content-Disposition: form-data; name=\"{}\"; filename=\"{}\"\r\nContent-Type: {ct}\r\n\r\n",
                                escape(key),
                                escape(&name)
                            )
                            .as_bytes(),
                        );
                        out.extend_from_slice(&data);
                    }
                }
                out.extend_from_slice(b"\r\n");
            }
            out.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
            (out, Some(format!("multipart/form-data; boundary={boundary}")))
        }
    })
}

fn escape(s: &str) -> String {
    s.replace('"', "%22").replace('\r', "%0D").replace('\n', "%0A")
}

/// Descomprime según Content-Encoding (gzip, deflate, br, zstd). Si falla, devuelve los bytes tal cual.
pub fn decode(encoding: Option<&str>, data: &[u8]) -> Vec<u8> {
    use std::io::Read;
    let Some(enc) = encoding.map(|e| e.trim().to_ascii_lowercase()) else { return data.to_vec() };
    let mut out = Vec::new();
    let ok = match enc.as_str() {
        "gzip" | "x-gzip" => flate2::read::MultiGzDecoder::new(data).read_to_end(&mut out).is_ok(),
        "deflate" => {
            flate2::read::ZlibDecoder::new(data).read_to_end(&mut out).is_ok() || {
                out.clear();
                flate2::read::DeflateDecoder::new(data).read_to_end(&mut out).is_ok()
            }
        }
        "br" => brotli::Decompressor::new(data, 4096).read_to_end(&mut out).is_ok(),
        "zstd" => zstd::stream::read::Decoder::new(data).and_then(|mut d| d.read_to_end(&mut out)).is_ok(),
        _ => false,
    };
    if ok { out } else { data.to_vec() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multipart_con_fichero() {
        let dir = std::env::temp_dir().join(format!("cartero-body-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a.json");
        std::fs::write(&file, b"{\"x\":1}").unwrap();
        let p = Prepared {
            body: PreparedBody::FormData(vec![
                FormPart::Text { key: "title".into(), value: "hola".into(), content_type: None },
                FormPart::File { key: "file".into(), path: file.to_string_lossy().into(), content_type: None },
            ]),
            ..Default::default()
        };
        let (bytes, ct) = build(&p).unwrap();
        let ct = ct.unwrap();
        let boundary = ct.split("boundary=").nth(1).unwrap();
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.starts_with(&format!("--{boundary}\r\n")));
        assert!(text.contains("name=\"title\"\r\n\r\nhola\r\n"));
        assert!(text.contains("filename=\"a.json\"\r\nContent-Type: application/json\r\n\r\n{\"x\":1}\r\n"));
        assert!(text.ends_with(&format!("--{boundary}--\r\n")));
        assert_eq!(urlencode(&[("a b".into(), "c&d=é".into())]), "a+b=c%26d%3D%C3%A9");
    }

    #[test]
    fn descomprime() {
        use std::io::Write;
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        gz.write_all(b"hola cartero").unwrap();
        assert_eq!(decode(Some("gzip"), &gz.finish().unwrap()), b"hola cartero");
        let mut br = Vec::new();
        brotli::CompressorWriter::new(&mut br, 4096, 5, 22).write_all(b"brotli").unwrap();
        assert_eq!(decode(Some("br"), &br), b"brotli");
        assert_eq!(decode(Some("gzip"), b"no es gzip"), b"no es gzip");
    }
}
