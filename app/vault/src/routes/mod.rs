//! Rotas do Cofre (seção 11.14). Sem `/api/v1` — este serviço só é
//! alcançado pelo `ecos-app` na rede interna (seção 2), que já normaliza o
//! prefixo antes de repassar (`routes::vault_proxy` no outro crate).

pub mod ativacao;
pub mod backup;
pub mod beneficiarios;
pub mod categorias;
pub mod contas;
pub mod health;
#[cfg(test)]
mod isolamento_testes;
pub mod pendencias;
pub mod recorrencias;
pub mod reset;
pub mod transacoes;
pub mod financeiro;
pub mod fluxo;

use crate::db::{id_de_usuario_valido, USUARIO};
use crate::error::AppError;
use crate::state::AppState;
use axum::extract::{Request, State};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, patch, post};
use axum::Router;
use ecos_core::ErrorCode;

/// Cabeçalho interno com o id do usuário autenticado pelo `ecos-app` (que o define do zero a cada chamada:
/// nada que venha do cliente chega até aqui). Este serviço só é alcançável na rede interna.
pub const CABECALHO_USUARIO: &str = "x-ecos-usuario";
/// `1` quando o `ecos-app` diz que este usuário é o dono do cofre único das versões anteriores.
pub const CABECALHO_DONO_LEGADO: &str = "x-ecos-dono-legado";

/// Toda rota `/vault/*` roda no escopo de um usuário: sem cabeçalho válido, 401 (falha fechada).
async fn escopo_de_usuario(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let usuario = req.headers().get(CABECALHO_USUARIO).and_then(|v| v.to_str().ok()).map(str::to_string).filter(|u| id_de_usuario_valido(u));
    let Some(usuario) = usuario else { return AppError::new(ErrorCode::Unauthorized).into_response() };
    if req.headers().get(CABECALHO_DONO_LEGADO).and_then(|v| v.to_str().ok()) == Some("1") {
        if let Err(err) = state.config.adotar_cofre_legado(&usuario) {
            tracing::error!(error = %err, "não foi possível atribuir o cofre anterior ao primeiro usuário");
            return AppError::new(ErrorCode::InternalError).into_response();
        }
    }
    let inicio = std::time::Instant::now();
    let mut response = USUARIO.scope(usuario, next.run(req)).await;
    tracing::info!(status = response.status().as_u16(), duracao_ms = inicio.elapsed().as_millis() as u64, "requisição do cofre concluída");
    response.headers_mut().insert(axum::http::header::CACHE_CONTROL, axum::http::HeaderValue::from_static("no-store, private"));
    response
}

pub fn montar(state: AppState) -> Router {
    Router::new()
        .route("/vault/ativar", post(ativacao::ativar))
        .route("/vault/desbloquear", post(ativacao::desbloquear))
        .route("/vault/bloquear", post(ativacao::bloquear))
        .route("/vault/config", get(ativacao::config))
        .route("/vault/contas", get(contas::listar).post(contas::criar))
        .route("/vault/contas/:id", patch(contas::atualizar).delete(contas::excluir))
        .route("/vault/categorias", get(categorias::listar).post(categorias::criar))
        .route("/vault/categorias/:id", patch(categorias::atualizar).delete(categorias::excluir))
        .route("/vault/beneficiarios", get(beneficiarios::listar).post(beneficiarios::criar_ou_encontrar))
        .route("/vault/painel", get(financeiro::painel))
        .route("/vault/financeiro/importar", post(financeiro::importar))
        .route("/vault/financeiro/exportar", get(financeiro::exportar))
        .route("/vault/financeiro/lote", post(financeiro::lote))
        .route("/vault/fluxo/ocorrencias", get(fluxo::listar))
        .route("/vault/recorrencias/:id/concluir", post(fluxo::concluir))
        .route("/vault/transacoes/:id/data", patch(fluxo::reagendar))
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
        .route("/vault/excluir", post(reset::excluir_cofre))
        .layer(middleware::from_fn_with_state(state.clone(), escopo_de_usuario))
        // Fora do escopo de usuário: é o liveness do container.
        .route("/health", get(health::liveness))
        .with_state(state)
}
