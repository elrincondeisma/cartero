//! Informes del runner: JSON y JUnit (para CI).

use crate::RunSummary;

pub fn json(summary: &RunSummary) -> String {
    serde_json::to_string_pretty(summary).unwrap_or_default()
}

fn xml(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

/// Una suite por petición e iteración y un caso por test, como newman.
pub fn junit(summary: &RunSummary) -> String {
    let mut out = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    out.push_str(&format!(
        "<testsuites name=\"{}\" tests=\"{}\" failures=\"{}\" time=\"{:.3}\">\n",
        xml(&summary.collection),
        summary.tests_passed + summary.tests_failed,
        summary.tests_failed,
        summary.duration_ms as f64 / 1000.0
    ));
    for r in &summary.results {
        let failures = r.tests.iter().filter(|t| !t.passed).count() + usize::from(r.error.is_some());
        out.push_str(&format!(
            "  <testsuite name=\"{}\" tests=\"{}\" failures=\"{failures}\" time=\"{:.3}\" timestamp=\"{}\">\n",
            xml(&format!("{} (iteración {})", r.name, r.iteration + 1)),
            r.tests.len().max(1),
            r.time_ms as f64 / 1000.0,
            xml(&summary.started_at)
        ));
        if let Some(e) = &r.error {
            out.push_str(&format!(
                "    <testcase name=\"{}\" classname=\"{}\">\n      <error message=\"{}\"/>\n    </testcase>\n",
                xml(&r.name),
                xml(&r.url),
                xml(e)
            ));
        }
        for t in &r.tests {
            out.push_str(&format!("    <testcase name=\"{}\" classname=\"{}\"", xml(&t.name), xml(&r.name)));
            if t.skipped {
                out.push_str(">\n      <skipped/>\n    </testcase>\n");
            } else if t.passed {
                out.push_str("/>\n");
            } else {
                out.push_str(&format!(">\n      <failure message=\"{}\"/>\n    </testcase>\n", xml(t.error.as_deref().unwrap_or("falló"))));
            }
        }
        out.push_str("  </testsuite>\n");
    }
    out.push_str("</testsuites>\n");
    out
}
