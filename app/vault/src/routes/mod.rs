//! Rotas do Cofre (seção 11.14). Sem `/api/v1` — este serviço só é
//! alcançado pelo `ecos-app` na rede interna (seção 2), que já normaliza o
//! prefixo antes de repassar (`routes::vault_proxy` no outro crate).

pub mod ativacao;
pub mod backup;
pub mod beneficiarios;
pub mod categorias;
pub mod contas;
pub mod health;
pub mod pendencias;
pub mod recorrencias;
pub mod reset;
pub mod transacoes;

use crate::state::AppState;
use axum::routing::{delete, get, patch, post};
use axum::Router;

pub fn montar(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health::liveness))
        .route("/vault/ativar", post(ativacao::ativar))
        .route("/vault/desbloquear", post(ativacao::desbloquear))
        .route("/vault/bloquear", post(ativacao::bloquear))
        .route("/vault/config", get(ativacao::config))
        .route("/vault/contas", get(contas::listar).post(contas::criar))
        .route("/vault/contas/:id", patch(contas::atualizar).delete(contas::excluir))
        .route("/vault/categorias", get(categorias::listar).post(categorias::criar))
        .route("/vault/categorias/:id", patch(categorias::atualizar).delete(categorias::excluir))
        .route("/vault/beneficiarios", get(beneficiarios::listar).post(beneficiarios::criar_ou_encontrar))
        .route("/vault/transacoes", get(transacoes::listar).post(transacoes::criar))
        .route("/vault/transacoes/excluir-em-lote", post(transacoes::excluir_em_lote))
        .route("/vault/transacoes/captura-foto", post(transacoes::captura_foto))
        .route("/vault/transacoes/:id", get(transacoes::obter).patch(transacoes::atualizar).delete(transacoes::excluir))
        .route("/vault/transacoes/:id/status", patch(transacoes::atualizar_status))
        .route("/vault/transacoes/:id/anexos", get(transacoes::listar_anexos).post(transacoes::upload_anexo))
        .route("/vault/anexos/:id", delete(transacoes::excluir_anexo))
        .route("/vault/recorrencias", get(recorrencias::listar).post(recorrencias::criar))
        .route("/vault/recorrencias/:id", get(recorrencias::obter).patch(recorrencias::atualizar).delete(recorrencias::excluir))
        .route("/vault/recorrencias/:id/duplicar", post(recorrencias::duplicar))
        .route("/vault/recorrencias/:id/exclusoes", post(recorrencias::adicionar_exclusao))
        .route("/vault/pendencias", get(pendencias::listar).post(pendencias::criar))
        .route("/vault/pendencias/:id", delete(pendencias::excluir))
        .route("/vault/pendencias/:id/converter", post(pendencias::converter))
        .route("/vault/backup/config", get(backup::config).patch(backup::atualizar_config))
        .route("/vault/backup/historico", get(backup::historico))
        .route("/vault/backup/exportar", post(backup::exportar))
        .route("/vault/backup/exportar-csv", post(backup::exportar_csv))
        .route("/vault/reset", post(reset::reset))
        .with_state(state)
}
