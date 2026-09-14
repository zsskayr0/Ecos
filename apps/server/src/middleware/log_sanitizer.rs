//! Formatter de log JSON (um objeto por linha, seção 3.2) que nunca deixa
//! um campo sensível passar — implementado como camada comum do `tracing`
//! (seção 5.4: "vale pro app inteiro, não só o Cofre"), não como convenção
//! por call-site. Qualquer `tracing::info!(senha = ..., ...)` sai como
//! `"senha":"[REDACTED]"` na linha de log, independente de quem chamou.

use serde_json::{json, Map, Value};
use tracing::field::{Field, Visit};
use tracing::{Event, Subscriber};
use tracing_subscriber::fmt::format::{FormatEvent, Writer};
use tracing_subscriber::fmt::{FmtContext, FormatFields};
use tracing_subscriber::registry::LookupSpan;

/// Nomes de campo que nunca aparecem em claro num log, em nenhum
/// `bounded_context` — senha, recovery key, cookies/tokens de sessão e
/// OAuth, e os campos de conteúdo de Transação do Cofre (seção 3.2/5.4).
const CAMPOS_SENSIVEIS: &[&str] = &[
    "senha",
    "nova_senha",
    "recovery_key",
    "recovery_key_hash",
    "senha_hash",
    "cookie",
    "access_token",
    "refresh_token",
    "refresh_token_hash",
    "token",
    "session_secret",
    "publico_chave",
    "valor_centavos",
    "descricao",
    "observacoes",
    "ocr_texto_bruto",
];

pub struct SanitizedJsonFormatter;

impl<S, N> FormatEvent<S, N> for SanitizedJsonFormatter
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
{
    fn format_event(&self, _ctx: &FmtContext<'_, S, N>, mut writer: Writer<'_>, event: &Event<'_>) -> std::fmt::Result {
        let metadata = event.metadata();
        let mut visitor = RedactingVisitor::default();
        event.record(&mut visitor);

        let mut objeto = Map::new();
        objeto.insert("timestamp".into(), json!(chrono::Utc::now().to_rfc3339()));
        objeto.insert("nivel".into(), json!(metadata.level().to_string()));
        objeto.insert("alvo".into(), json!(metadata.target()));
        for (nome, valor) in visitor.campos {
            objeto.insert(nome, valor);
        }

        writeln!(writer, "{}", Value::Object(objeto))
    }
}

#[derive(Default)]
struct RedactingVisitor {
    campos: Vec<(String, Value)>,
}

impl RedactingVisitor {
    fn nome_final(campo: &Field) -> String {
        if campo.name() == "message" {
            "mensagem".to_string()
        } else {
            campo.name().to_string()
        }
    }

    fn empurrar(&mut self, campo: &Field, valor: Value) {
        let nome = Self::nome_final(campo);
        if CAMPOS_SENSIVEIS.contains(&campo.name()) {
            self.campos.push((nome, json!("[REDACTED]")));
        } else {
            self.campos.push((nome, valor));
        }
    }
}

impl Visit for RedactingVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.empurrar(field, json!(format!("{value:?}")));
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        self.empurrar(field, json!(value));
    }

    fn record_bool(&mut self, field: &Field, value: bool) {
        self.empurrar(field, json!(value));
    }

    fn record_i64(&mut self, field: &Field, value: i64) {
        self.empurrar(field, json!(value));
    }

    fn record_u64(&mut self, field: &Field, value: u64) {
        self.empurrar(field, json!(value));
    }

    fn record_f64(&mut self, field: &Field, value: f64) {
        self.empurrar(field, json!(value));
    }
}

#[cfg(test)]
mod tests {
    use super::CAMPOS_SENSIVEIS;

    #[test]
    fn lista_de_campos_sensiveis_cobre_o_essencial_da_secao_5_4() {
        for esperado in ["senha", "recovery_key", "access_token", "valor_centavos", "descricao"] {
            assert!(CAMPOS_SENSIVEIS.contains(&esperado), "faltando: {esperado}");
        }
    }
}
