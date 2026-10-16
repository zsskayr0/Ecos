//! Valores padrao de campos serde compartilhados entre as rotas do Cofre.

/// Espaco assumido quando o payload nao informa `espaco`.
pub(super) fn espaco_padrao() -> String {
    "pessoal".to_string()
}
