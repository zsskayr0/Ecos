//! Biblioteca de mídia do cofre. Arquivos ficam em `src/Media/AAAA-MM/` com
//! um nome legível e um ULID curto: `reuniao-01K...pdf`. O ID evita colisão;
//! o texto continua reconhecível em backup, git ou explorador de arquivos.

use axum::extract::{Multipart, Path, State};
use axum::Json;
use chrono::{Datelike, Utc};
use ecos_core::{naming, new_id, ErrorCode};
use serde::Serialize;
use std::path::{Component, Path as FsPath, PathBuf};

use crate::error::{AppError, AppResult, CampoInvalido};
use crate::routes::anexos_comuns::{mime_por_extensao, TAMANHO_MAXIMO_BYTES};
use crate::state::AppState;

pub fn raiz(state: &AppState) -> PathBuf { state.config.notes_root.join("src").join("Media") }

fn nome_legivel(nome: &str) -> String {
    let (base, ext) = nome.rsplit_once('.').map(|(b, e)| (b, format!(".{e}"))).unwrap_or((nome, String::new()));
    let base = base.rsplit_once('-').filter(|(_, id)| ulid::Ulid::from_string(id).is_ok()).map(|(b, _)| b).unwrap_or(base);
    format!("{base}{ext}")
}

fn caminho_seguro(raiz: &FsPath, relativo: &str) -> Option<PathBuf> {
    let p = FsPath::new(relativo);
    if relativo.is_empty() || p.components().any(|c| !matches!(c, Component::Normal(_))) { return None; }
    Some(raiz.join(p))
}

fn nome_humano_com_id(nome: &str) -> String {
    let nome = naming::sanitizar_nome_arquivo(nome);
    let (base, ext) = nome.rsplit_once('.').filter(|(b, e)| !b.is_empty() && !e.is_empty()).unwrap_or((&nome, ""));
    let id = new_id();
    if ext.is_empty() { format!("{base}-{id}") } else { format!("{base}-{id}.{ext}") }
}

#[derive(Serialize)]
pub struct MidiaResumo { pub caminho: String, pub nome: String, pub tamanho_bytes: u64, pub mime: String, pub enviado_em: String }

pub async fn enviar_para_biblioteca(state: &AppState, mut multipart: Multipart) -> AppResult<MidiaResumo> {
    let campo = multipart.next_field().await.map_err(|_| AppError::new(ErrorCode::ValidationError).with_message("O envio do arquivo está incompleto ou inválido. Selecione o arquivo novamente."))?
        .ok_or_else(|| AppError::new(ErrorCode::ValidationError).with_message("Nenhum arquivo foi enviado. Escolha um arquivo para anexar."))?;
    if campo.name() != Some("arquivo") {
        return Err(AppError::new(ErrorCode::ValidationError).with_message("O envio não contém um arquivo válido. Selecione o arquivo novamente."));
    }
    let original = campo.file_name().unwrap_or("arquivo").to_string();
    let bytes = campo.bytes().await.map_err(|_| AppError::new(ErrorCode::ValidationError).with_message("O envio foi interrompido ou excedeu o limite. Envie novamente um arquivo de até 120 MB."))?;
    if bytes.is_empty() { return Err(AppError::new(ErrorCode::ValidationError).with_message("O arquivo está vazio. Escolha outro arquivo.")); }
    if bytes.len() > TAMANHO_MAXIMO_BYTES { return Err(AppError::validation(vec![CampoInvalido { campo: "arquivo".into(), motivo: "maior que 120 MB".into() }])); }
    let agora = Utc::now();
    let pasta = format!("{:04}-{:02}", agora.year(), agora.month());
    let nome = nome_humano_com_id(&original);
    let dir = raiz(&state).join(&pasta);
    std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(dir.join(&nome), &bytes)).map_err(|err| {
        tracing::error!(error = %err, "falha ao guardar mídia");
        AppError::new(ErrorCode::InternalError).with_message("Não foi possível guardar o arquivo no servidor. Verifique o espaço disponível e a permissão da pasta de mídia.")
    })?;
    let caminho = format!("src/Media/{pasta}/{nome}");
    Ok(MidiaResumo { caminho, nome: naming::sanitizar_nome_arquivo(&original), tamanho_bytes: bytes.len() as u64, mime: mime_por_extensao(&original).to_string(), enviado_em: agora.to_rfc3339() })
}

pub async fn enviar(State(state): State<AppState>, multipart: Multipart) -> AppResult<Json<MidiaResumo>> {
    Ok(Json(enviar_para_biblioteca(&state, multipart).await?))
}

pub async fn listar(State(state): State<AppState>) -> AppResult<Json<Vec<MidiaResumo>>> {
    let raiz = raiz(&state);
    let mut itens = Vec::new();
    if raiz.exists() {
        for entry in walkdir::WalkDir::new(&raiz).into_iter().filter_map(|e| e.ok()).filter(|e| e.file_type().is_file()) {
            let Ok(rel) = entry.path().strip_prefix(&state.config.notes_root) else { continue };
            let nome = entry.file_name().to_string_lossy().to_string();
            let metadata = entry.metadata().ok();
            let tamanho_bytes = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
            let enviado_em = metadata.and_then(|m| m.modified().ok()).map(chrono::DateTime::<Utc>::from).unwrap_or_else(Utc::now).to_rfc3339();
            itens.push(MidiaResumo { caminho: rel.to_string_lossy().replace('\\', "/"), mime: mime_por_extensao(&nome).to_string(), nome: nome_legivel(&nome), tamanho_bytes, enviado_em });
        }
    }
    itens.sort_by(|a, b| b.enviado_em.cmp(&a.enviado_em));
    Ok(Json(itens))
}

pub async fn obter_arquivo(State(state): State<AppState>, Path(caminho): Path<String>) -> AppResult<([(axum::http::HeaderName, String); 1], Vec<u8>)> {
    let relativo = format!("src/Media/{}", caminho.trim_start_matches('/'));
    let Some(arquivo) = caminho_seguro(&state.config.notes_root, &relativo) else { return Err(AppError::new(ErrorCode::NotFound)); };
    if !arquivo.is_file() { return Err(AppError::new(ErrorCode::NotFound)); }
    let nome = arquivo.file_name().and_then(|n| n.to_str()).unwrap_or("");
    Ok(([(axum::http::header::CONTENT_TYPE, mime_por_extensao(nome).to_string())], std::fs::read(arquivo)?))
}

/// Retira o ativo da biblioteca preservando uma cópia recuperável. Não
/// reescreve as Notas/Tarefas que o referenciam: seus Markdown são do usuário.
pub async fn excluir(State(state): State<AppState>, Path(caminho): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let media_root = raiz(&state);
    let arquivo = caminho_seguro(&media_root, caminho.trim_start_matches('/')).ok_or(AppError::new(ErrorCode::NotFound))?;
    if !arquivo.is_file() { return Err(AppError::new(ErrorCode::NotFound)); }
    let canonical_root = std::fs::canonicalize(&media_root)?;
    let canonical_file = std::fs::canonicalize(&arquivo)?;
    if !canonical_file.starts_with(&canonical_root) { return Err(AppError::new(ErrorCode::Forbidden)); }
    let destino = state.config.notes_root.join(".ecos").join("lixeira").join("media").join(new_id()).join(caminho.trim_start_matches('/'));
    std::fs::create_dir_all(destino.parent().unwrap())?;
    std::fs::rename(&arquivo, destino).map_err(|err| {
        tracing::error!(error = %err, "falha ao mover mídia para lixeira");
        AppError::new(ErrorCode::InternalError).with_message("Não foi possível excluir o arquivo. Verifique a permissão da pasta de mídia e tente novamente.")
    })?;
    Ok(Json(serde_json::json!({ "ok": true, "message": "Arquivo movido para a lixeira." })))
}

fn raiz_lixeira(state: &AppState) -> PathBuf { state.config.notes_root.join(".ecos/lixeira/media") }

#[derive(Serialize, serde::Deserialize)]
pub struct ItemLixeira {
    pub tipo: String,
    pub id: String,
    pub nome: String,
    pub caminho_original: String,
    pub tamanho_bytes: u64,
    pub mime: String,
    pub excluido_em: String,
}

pub async fn listar_lixeira(State(state): State<AppState>) -> AppResult<Json<Vec<ItemLixeira>>> {
    let root = raiz_lixeira(&state);
    let mut itens = Vec::new();
    for entry in walkdir::WalkDir::new(&root).into_iter().filter_map(Result::ok).filter(|e| e.file_type().is_file()) {
        let relativo = entry.path().strip_prefix(&root).unwrap();
        let mut partes = relativo.components();
        let Some(Component::Normal(id)) = partes.next() else { continue };
        let id = id.to_string_lossy().to_string();
        if ulid::Ulid::from_string(&id).is_err() { continue; }
        let caminho = partes.as_path().to_string_lossy().replace('\\', "/");
        let nome = entry.file_name().to_string_lossy();
        let excluido = std::fs::metadata(root.join(&id))?.modified()?;
        let excluido: chrono::DateTime<Utc> = excluido.into();
        itens.push(ItemLixeira { tipo: "media".into(), id, nome: nome_legivel(&nome), caminho_original: format!("src/Media/{caminho}"), tamanho_bytes: entry.metadata().map_err(std::io::Error::from)?.len(), mime: mime_por_extensao(&nome).to_string(), excluido_em: excluido.to_rfc3339() });
    }
    itens.extend(super::lixeira::listar(&state)?);
    itens.sort_by(|a, b| b.excluido_em.cmp(&a.excluido_em));
    Ok(Json(itens))
}

pub async fn restaurar(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
    if id.starts_with("documento-") {
        super::lixeira::restaurar(&state, &id).await?;
        return Ok(Json(serde_json::json!({ "ok": true, "message": "Item restaurado." })));
    }
    if ulid::Ulid::from_string(&id).is_err() { return Err(AppError::new(ErrorCode::NotFound)); }
    let root = raiz_lixeira(&state);
    let dir = root.join(id);
    let item = walkdir::WalkDir::new(&dir).into_iter().filter_map(Result::ok).find(|e| e.file_type().is_file()).ok_or(AppError::new(ErrorCode::NotFound))?;
    let canonical_root = std::fs::canonicalize(&root)?;
    if !std::fs::canonicalize(item.path())?.starts_with(canonical_root) { return Err(AppError::new(ErrorCode::Forbidden)); }
    let relativo = item.path().strip_prefix(&dir).unwrap().to_string_lossy().replace('\\', "/");
    let destino = caminho_seguro(&raiz(&state), &relativo).ok_or(AppError::new(ErrorCode::NotFound))?;
    if destino.exists() { return Err(AppError::new(ErrorCode::Conflict).with_message("Já existe um arquivo no caminho original. Resolva o conflito antes de restaurar.")); }
    std::fs::create_dir_all(destino.parent().unwrap())?;
    let canonical_media = std::fs::canonicalize(raiz(&state))?;
    if !std::fs::canonicalize(destino.parent().unwrap())?.starts_with(canonical_media) { return Err(AppError::new(ErrorCode::Forbidden)); }
    std::fs::rename(item.path(), destino).map_err(|err| {
        tracing::error!(error = %err, "falha ao restaurar mídia");
        AppError::new(ErrorCode::InternalError).with_message("Não foi possível restaurar o arquivo. Verifique o armazenamento do servidor e tente novamente.")
    })?;
    Ok(Json(serde_json::json!({ "ok": true, "message": "Arquivo restaurado." })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{auth::session, config::{Ambiente, Config}, db::IndexDb};
    use axum::{body::{to_bytes, Body}, http::{Request, StatusCode}};
    use std::sync::{Arc, Mutex};
    use tower::Service;

    // Exercita o roteador e a autenticação de verdade, sem contas ou
    // arquivos do usuário e sem precisar criar uma Nota/Tarefa antes.
    #[tokio::test]
    async fn upload_global_maior_que_limite_padrao_persiste_e_pode_ser_lido() {
        let temp = std::env::temp_dir().join(format!("ecos-media-test-{}", new_id()));
        std::fs::create_dir_all(&temp).unwrap();
        let secret = b"segredo-efemero-exclusivo-do-teste".to_vec();
        let state = AppState {
            db: IndexDb::open(&temp.join("index.db")).unwrap(),
            config: Arc::new(Config {
                ambiente: Ambiente::Desenvolvimento, porta: 0, notes_root: temp.clone(),
                index_db_path: temp.join("index.db"), vault_enabled: false, vault_internal_url: String::new(),
                session_secret: secret.clone(), ranking_interval_secs: 300, static_dir: None, cookie_secure: false,
            }),
            http: reqwest::Client::new(), pareamentos: Arc::new(Mutex::new(Default::default())),
        };
        state.db.with(|conn| {
            conn.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash) VALUES ('usuario-teste', 'teste', 'efemero', 'efemero')", [])?;
            Ok(())
        }).await.unwrap();
        let app = crate::routes::montar(state);
        let denied = app.clone().call(Request::post("/api/v1/media").body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(denied.status(), StatusCode::UNAUTHORIZED);
        let token = session::emitir_access_token("usuario-teste", &secret).unwrap();
        let data = vec![b'x'; 3 * 1024 * 1024];
        let mut body = b"--ecos-test\r\nContent-Disposition: form-data; name=\"arquivo\"; filename=\"Relatorio legivel.pdf\"\r\nContent-Type: application/pdf\r\n\r\n".to_vec();
        body.extend_from_slice(&data);
        body.extend_from_slice(b"\r\n--ecos-test--\r\n");
        let response = app.clone().call(Request::post("/api/v1/media")
            .header("authorization", format!("Bearer {token}"))
            .header("content-type", "multipart/form-data; boundary=ecos-test")
            .body(Body::from(body)).unwrap()).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let item: serde_json::Value = serde_json::from_slice(&to_bytes(response.into_body(), 8192).await.unwrap()).unwrap();
        let caminho = item["caminho"].as_str().unwrap();
        assert_eq!(item["nome"], "Relatorio legivel.pdf");
        assert!(caminho.starts_with("src/Media/"));
        assert_eq!(std::fs::read(temp.join(caminho)).unwrap(), data);
        let uri = format!("/api/v1/media/arquivo/{}", caminho.trim_start_matches("src/Media/").replace(' ', "%20"));
        let preview = app.clone().call(Request::get(uri).header("authorization", format!("Bearer {token}")).body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(preview.status(), StatusCode::OK);
        assert_eq!(preview.headers()["content-type"], "application/pdf");
        assert_eq!(to_bytes(preview.into_body(), 4 * 1024 * 1024).await.unwrap().as_ref(), data);
        let delete_uri = format!("/api/v1/media/arquivo/{}", caminho.trim_start_matches("src/Media/").replace(' ', "%20"));
        let excluded = app.clone().call(Request::delete(delete_uri).header("authorization", format!("Bearer {token}")).body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(excluded.status(), StatusCode::OK);
        assert!(!temp.join(caminho).exists());
        let recuperavel = walkdir::WalkDir::new(temp.join(".ecos/lixeira/media")).into_iter().filter_map(Result::ok).find(|e| e.file_type().is_file()).unwrap();
        assert_eq!(std::fs::read(recuperavel.path()).unwrap(), data);
        let trash = app.clone().call(Request::get("/api/v1/lixeira").header("authorization", format!("Bearer {token}")).body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(trash.status(), StatusCode::OK);
        let trash: serde_json::Value = serde_json::from_slice(&to_bytes(trash.into_body(), 8192).await.unwrap()).unwrap();
        assert_eq!(trash[0]["nome"], "Relatorio legivel.pdf");
        let trash_id = trash[0]["id"].as_str().unwrap();
        let restored = app.clone().call(Request::post(format!("/api/v1/lixeira/{trash_id}/restaurar")).header("authorization", format!("Bearer {token}")).body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(restored.status(), StatusCode::OK);
        assert_eq!(std::fs::read(temp.join(caminho)).unwrap(), data);
        let empty_trash = app.clone().call(Request::get("/api/v1/lixeira").header("authorization", format!("Bearer {token}")).body(Body::empty()).unwrap()).await.unwrap();
        let empty_trash: serde_json::Value = serde_json::from_slice(&to_bytes(empty_trash.into_body(), 8192).await.unwrap()).unwrap();
        assert_eq!(empty_trash, serde_json::json!([]));
        for (rota, tipo, arvore) in [("notas", "nota", "Notas"), ("tarefas", "tarefa", "Tarefas")] {
            let created = app.clone().call(Request::post(format!("/api/v1/{rota}"))
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"titulo":"Recuperavel","corpo":"Descricao preservada"}"#)).unwrap()).await.unwrap();
            assert_eq!(created.status(), StatusCode::OK);
            let created: serde_json::Value = serde_json::from_slice(&to_bytes(created.into_body(), 8192).await.unwrap()).unwrap();
            let entity_id = created["id"].as_str().unwrap();
            let path = walkdir::WalkDir::new(temp.join("Pessoal").join(arvore)).into_iter().filter_map(Result::ok).find(|e| e.path().extension().is_some_and(|x| x == "md")).unwrap().path().to_path_buf();
            let original = std::fs::read(&path).unwrap();
            let attachments = path.parent().unwrap().join("_anexos").join(entity_id);
            std::fs::create_dir_all(&attachments).unwrap();
            std::fs::write(attachments.join("teste.txt"), b"anexo legado").unwrap();
            let deleted = app.clone().call(Request::delete(format!("/api/v1/{rota}/{entity_id}")).header("authorization", format!("Bearer {token}")).body(Body::empty()).unwrap()).await.unwrap();
            assert_eq!(deleted.status(), StatusCode::OK);
            assert!(!path.exists());
            assert!(!attachments.exists());
            let trash = app.clone().call(Request::get("/api/v1/lixeira").header("authorization", format!("Bearer {token}")).body(Body::empty()).unwrap()).await.unwrap();
            let trash: serde_json::Value = serde_json::from_slice(&to_bytes(trash.into_body(), 8192).await.unwrap()).unwrap();
            assert_eq!(trash[0]["tipo"], tipo);
            let id = trash[0]["id"].as_str().unwrap();
            std::fs::write(&path, b"conflito").unwrap();
            let conflict = app.clone().call(Request::post(format!("/api/v1/lixeira/{id}/restaurar")).header("authorization", format!("Bearer {token}")).body(Body::empty()).unwrap()).await.unwrap();
            assert_eq!(conflict.status(), StatusCode::CONFLICT);
            assert_eq!(std::fs::read(&path).unwrap(), b"conflito");
            std::fs::remove_file(&path).unwrap();
            let restored = app.clone().call(Request::post(format!("/api/v1/lixeira/{id}/restaurar")).header("authorization", format!("Bearer {token}")).body(Body::empty()).unwrap()).await.unwrap();
            assert_eq!(restored.status(), StatusCode::OK);
            assert_eq!(std::fs::read(&path).unwrap(), original);
            assert_eq!(std::fs::read(attachments.join("teste.txt")).unwrap(), b"anexo legado");
            let available = app.clone().call(Request::get(format!("/api/v1/{rota}/{entity_id}")).header("authorization", format!("Bearer {token}")).body(Body::empty()).unwrap()).await.unwrap();
            assert_eq!(available.status(), StatusCode::OK);
        }
        let traversal = app.clone().call(Request::delete("/api/v1/media/arquivo/..%2F..%2Findex.db").header("authorization", format!("Bearer {token}")).body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(traversal.status(), StatusCode::NOT_FOUND);
        assert!(temp.join("index.db").exists());
        let unknown = app.clone().call(Request::post("/api/v1/rota-ausente").body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(unknown.status(), StatusCode::NOT_FOUND);
        assert!(unknown.headers()["content-type"].to_str().unwrap().contains("application/json"));
        drop(app);
        std::fs::remove_dir_all(temp).unwrap();
    }
}
