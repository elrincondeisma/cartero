//! Ficheros de datos del runner: CSV (con cabecera) o JSON (lista de objetos).

use std::collections::HashMap;

use serde_json::Value;

pub type Row = HashMap<String, String>;

#[derive(Debug, thiserror::Error)]
pub enum DataError {
    #[error("el fichero de datos no es CSV ni una lista JSON de objetos")]
    Format,
    #[error("CSV no válido: {0}")]
    Csv(String),
}

pub fn parse(text: &str) -> Result<Vec<Row>, DataError> {
    let t = text.trim_start_matches('\u{feff}').trim();
    if t.starts_with('[') {
        let list: Vec<Value> = serde_json::from_str(t).map_err(|_| DataError::Format)?;
        return list
            .into_iter()
            .map(|row| match row {
                Value::Object(o) => {
                    Ok(o.into_iter().map(|(k, v)| (k, v.as_str().map(String::from).unwrap_or_else(|| v.to_string()))).collect())
                }
                _ => Err(DataError::Format),
            })
            .collect();
    }
    let mut reader = csv::ReaderBuilder::new().flexible(true).trim(csv::Trim::Headers).from_reader(t.as_bytes());
    let headers: Vec<String> = reader.headers().map_err(|e| DataError::Csv(e.to_string()))?.iter().map(String::from).collect();
    let mut rows = vec![];
    for rec in reader.records() {
        let rec = rec.map_err(|e| DataError::Csv(e.to_string()))?;
        rows.push(headers.iter().cloned().zip(rec.iter().map(String::from)).collect());
    }
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_y_json() {
        let rows = parse("user,pass\nana,\"a,1\"\nluis,2\n").unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["pass"], "a,1");
        let rows = parse(r#"[{"user":"ana","n":1}]"#).unwrap();
        assert_eq!(rows[0]["n"], "1");
        assert!(parse("[1,2]").is_err());
    }
}
