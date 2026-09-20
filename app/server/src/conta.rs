//! Conta e dados (LGPD): `GET /me/export` gera o `.zip` real com notas, tarefas e
//! anexos; `DELETE /me` apaga a conta e os dados da pessoa do servidor — banco
//! e arquivos —, sem depender do operador.

use axum::body::Body;
use axum::extract::State;
use axum::http::{header, HeaderValue};
use axum::response::Response;
use axum::{Extension, Json};
use axum_extra::extract::cookie::CookieJar;
use ecos_core::{new_id, ErrorCode};
use serde::Deserialize;
use std::path::{Component, Path, PathBuf};

use crate::auth::session;
use crate::error::{AppError, AppResult};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::state::AppState;
use crate::zip::ZipWriter;

pub const FRASE_EXCLUSAO: &str = "EXCLUIR CONTA";
const FRASE_RESET_COFRE: &str = "APAGAR TUDO";

const LEIA_ME: &str = "Exportação de dados do Ecos\r\n\
===========================\r\n\r\n\
manifesto.json          Seus dados de conta e o resumo do que está neste arquivo.\r\n\
Pessoal/                Suas Notas, Tarefas e anexos (src/Media), no formato original: arquivos .md.\r\n\
<Nome da equipe>/       Notas e Tarefas de equipes que VOCÊ criou. O que outras pessoas criaram não entra.\r\n\
perfil/                 Sua foto de perfil, se houver.\r\n\r\n\
Não entram: itens da lixeira, senhas e chaves de recuperação (ficam só como hash no servidor)\r\n\
e o Cofre financeiro, que tem exportação própria (Cofre > exportar).\r\n";

fn erro_interno(contexto: &str, err: impl std::fmt::Display) -> AppError {
    tracing::error!(error = %err, "{contexto}");
    AppError::new(ErrorCode::InternalError)
}

/// Só caminhos relativos e sem `..`: nada que saia da raiz de notas.
fn relativo_seguro(rel: &str) -> bool {
    !rel.is_empty() && Path::new(rel).components().all(|c| matches!(c, Component::Normal(_)))
}

struct DadosExportacao {
    nome_usuario: String,
    nome: Option<String>,
    criado_em: String,
    equipes: Vec<(String, String, String)>,
    itens_de_equipe: Vec<String>,
}

fn coletar_arquivos(state: &AppState, dados: &DadosExportacao, usuario_id: &str) -> Vec<(String, PathBuf)> {
    let raiz = &state.config.notes_root;
    let mut arquivos = Vec::new();
    let pessoal = raiz.join(crate::espacos::PESSOAL_DIR);
    for e in walkdir::WalkDir::new(&pessoal).follow_links(false).into_iter().filter_map(Result::ok) {
        if !e.file_type().is_file() || e.file_name() == crate::espacos::MARCADOR { continue; }
        if let Ok(rel) = e.path().strip_prefix(raiz) {
            arquivos.push((rel.to_string_lossy().replace('\\', "/"), e.path().to_path_buf()));
        }
    }
    for rel in &dados.itens_de_equipe {
        let rel = rel.replace('\\', "/");
        let caminho = raiz.join(&rel);
        if relativo_seguro(&rel) && caminho.is_file() { arquivos.push((rel, caminho)); }
    }
    if let Some((caminho, ext)) = crate::routes::avatar::arquivo_existente(state, usuario_id) {
        arquivos.push((format!("perfil/avatar.{ext}"), caminho));
    }
    arquivos
}

fn montar_zip(destino: &Path, dados: &DadosExportacao, arquivos: &[(String, PathBuf)], usuario_id: &str, cofre_ativo: bool) -> std::io::Result<()> {
    let saida = std::io::BufWriter::new(std::fs::File::create(destino)?);
    let mut zip = ZipWriter::new(saida);
    let anexos = arquivos.iter().filter(|(nome, _)| nome.contains("/src/Media/")).count();
    let manifesto = serde_json::json!({
        "gerado_em": chrono::Utc::now().to_rfc3339(),
        "usuario": { "id": usuario_id, "nome_usuario": dados.nome_usuario, "nome": dados.nome, "criado_em": dados.criado_em },
        "equipes": dados.equipes.iter().map(|(id, nome, cargo)| serde_json::json!({ "id": id, "nome": nome, "cargo": cargo })).collect::<Vec<_>>(),
        "arquivos": arquivos.len(),
        "anexos": anexos,
        "itens_de_equipe_incluidos": dados.itens_de_equipe.len(),
        "cofre": if cofre_ativo { "Não incluído: use a exportação do próprio Cofre." } else { "Cofre não ativado" },
    });
    zip.adicionar_bytes("LEIA-ME.txt", LEIA_ME.as_bytes())?;
    zip.adicionar_bytes("manifesto.json", &serde_json::to_vec_pretty(&manifesto).map_err(std::io::Error::other)?)?;
    for (nome, caminho) in arquivos { zip.adicionar_arquivo(nome, caminho)?; }
    zip.finalizar()?.into_inner().map_err(|e| e.into_error())?.sync_all()
}

/// `GET /me/export` — `.zip` com o que a pessoa tem no servidor.
pub async fn exportar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>) -> AppResult<Response> {
    let id = usuario.0.clone();
    let (nome_usuario, nome, criado_em, equipes, itens_de_equipe) = state.db.with(move |conn| {
        let (nome_usuario, nome, criado_em) = conn.query_row("SELECT nome_usuario, nome, criado_em FROM usuario WHERE id = ?1", [&id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, String>(2)?)))?;
        let mut stmt = conn.prepare("SELECT e.id, e.nome, m.cargo FROM equipe e JOIN membro_equipe m ON m.equipe_id = e.id WHERE m.usuario_id = ?1")?;
        let equipes = stmt.query_map([&id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?.collect::<Result<Vec<_>, _>>()?;
        let mut stmt = conn.prepare("SELECT caminho_arquivo FROM nota WHERE criado_por = ?1 AND espaco != 'pessoal' UNION ALL SELECT caminho_arquivo FROM tarefa WHERE criado_por = ?1 AND espaco != 'pessoal'")?;
        let itens = stmt.query_map([&id], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
        Ok((nome_usuario, nome, criado_em, equipes, itens))
    }).await.map_err(|_| AppError::new(ErrorCode::Unauthorized))?;
    let dados = DadosExportacao { nome_usuario, nome, criado_em, equipes, itens_de_equipe };

    let pasta_tmp = state.config.notes_root.join(".ecos").join("tmp");
    std::fs::create_dir_all(&pasta_tmp).map_err(|e| erro_interno("criar pasta temporária da exportação", e))?;
    let temporario = pasta_tmp.join(format!("exportacao-{}.zip", new_id()));
    let (destino, cofre_ativo, usuario_id) = (temporario.clone(), state.config.vault_enabled, usuario.0.clone());
    let arquivos = coletar_arquivos(&state, &dados, &usuario_id);
    let gerado = tokio::task::spawn_blocking(move || montar_zip(&destino, &dados, &arquivos, &usuario_id, cofre_ativo)).await;
    match gerado {
        Ok(Ok(())) => {}
        Ok(Err(e)) => { let _ = std::fs::remove_file(&temporario); return Err(erro_interno("gerar .zip da exportação", e)); }
        Err(e) => { let _ = std::fs::remove_file(&temporario); return Err(erro_interno("gerar .zip da exportação", e)); }
    }

    let arquivo = tokio::fs::File::open(&temporario).await.map_err(|e| erro_interno("abrir .zip da exportação", e))?;
    let tamanho = arquivo.metadata().await.map_err(|e| erro_interno("ler tamanho do .zip", e))?.len();
    // Já aberto: apagar agora não interrompe a leitura, e nada fica em disco depois do download.
    let _ = std::fs::remove_file(&temporario);
    let nome = format!("ecos-exportacao-{}.zip", chrono::Utc::now().format("%Y%m%d-%H%M%S"));
    let mut resposta = Response::new(Body::from_stream(tokio_util::io::ReaderStream::new(arquivo)));
    let h = resposta.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/zip"));
    h.insert(header::CONTENT_LENGTH, HeaderValue::from(tamanho));
    h.insert(header::CONTENT_DISPOSITION, HeaderValue::from_str(&format!("attachment; filename=\"{nome}\"")).map_err(|e| erro_interno("cabeçalho", e))?);
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    Ok(resposta)
}

#[derive(Debug, Deserialize)]
pub struct ExcluirContaPayload {
    pub confirm: String,
}

fn remover(caminho: &Path, avisos: &mut Vec<String>) {
    let r = if caminho.is_dir() { std::fs::remove_dir_all(caminho) } else { std::fs::remove_file(caminho) };
    if let Err(e) = r {
        if e.kind() != std::io::ErrorKind::NotFound {
            tracing::error!(caminho = %caminho.display(), error = %e, "falha ao apagar arquivo da conta excluída");
            avisos.push(format!("Não foi possível apagar {}.", caminho.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()));
        }
    }
}

/// Troca o `criado_por` do front-matter por `null` nos itens que a pessoa criou em equipes que continuam:
/// o banco já perde a autoria na exclusão, e sem isto o ID ficaria no `.md` (e voltaria a cada reindex).
fn anonimizar_front_matter(raiz: &Path, caminhos: &[String], usuario_id: &str, avisos: &mut Vec<String>) {
    for rel in caminhos {
        if !relativo_seguro(rel) { continue; }
        let caminho = raiz.join(rel);
        let Ok(texto) = std::fs::read_to_string(&caminho) else { continue };
        let mut fechado = false;
        let mut dentro = false;
        let mut mudou = false;
        let novo: Vec<String> = texto.split('\n').enumerate().map(|(i, linha)| {
            let limpa = linha.trim_end_matches('\r');
            if i == 0 && limpa == "---" { dentro = true; return linha.to_string(); }
            if dentro && !fechado && limpa == "---" { fechado = true; return linha.to_string(); }
            let valor = limpa.strip_prefix("criado_por:").map(|v| v.trim().trim_matches(|c| c == '"' || c == '\''));
            if dentro && !fechado && valor == Some(usuario_id) {
                mudou = true;
                return format!("criado_por: null{}", if linha.ends_with('\r') { "\r" } else { "" });
            }
            linha.to_string()
        }).collect();
        if mudou && std::fs::write(&caminho, novo.join("\n")).is_err() {
            avisos.push(format!("Não foi possível remover o seu nome de {}.", caminho.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()));
        }
    }
}

/// Lixeira de documentos e de mídia: apaga o que pertence ao Pessoal ou a equipes removidas.
fn limpar_lixeira(state: &AppState, espacos_removidos: &[(String, PathBuf)], avisos: &mut Vec<String>) {
    let raiz = state.config.notes_root.join(".ecos").join("lixeira");
    let topo_removido = |topo: &str| matches!(topo, "Pessoal" | "Notas" | "Tarefas" | "Eventos") || espacos_removidos.iter().any(|(_, d)| d.file_name().is_some_and(|n| n.to_string_lossy() == topo));
    if let Ok(entradas) = std::fs::read_dir(raiz.join("documentos")) {
        for e in entradas.flatten() {
            let original = std::fs::read(e.path().join("registro.json")).ok().and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
                .and_then(|v| v["item"]["caminho_original"].as_str().map(str::to_string));
            let topo = original.as_deref().and_then(|o| o.split('/').next()).unwrap_or("Pessoal");
            if topo_removido(topo) { remover(&e.path(), avisos); }
        }
    }
    let media = raiz.join("media");
    if let Ok(entradas) = std::fs::read_dir(&media) {
        for e in entradas.flatten() {
            if !e.path().is_dir() { continue; }
            let id = e.file_name().to_string_lossy().to_string();
            let marcador = media.join(format!("{id}.espaco"));
            let espaco = std::fs::read_to_string(&marcador).ok().map(|s| s.trim().to_string()).unwrap_or_else(|| "pessoal".into());
            if espaco == "pessoal" || espacos_removidos.iter().any(|(e, _)| *e == espaco) {
                remover(&e.path(), avisos);
                remover(&marcador, avisos);
            }
        }
    }
}

/// `DELETE /me` — exige `{confirm:"EXCLUIR CONTA"}`. Apaga: conta, sessões, dispositivos, rotina,
/// notificações, integrações de calendário, foto, Notas/Tarefas/anexos do espaço Pessoal, a lixeira
/// correspondente e o Cofre. Equipes: a pessoa sai; se era a única integrante, a equipe e seus arquivos
/// também somem. Itens que ela criou em equipes com outras pessoas ficam (histórico compartilhado),
/// sem autoria. Quem é dono de equipe com outros integrantes precisa transferir a propriedade antes.
pub async fn excluir_conta(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, jar: CookieJar, Json(payload): Json<ExcluirContaPayload>) -> AppResult<(CookieJar, Json<serde_json::Value>)> {
    if payload.confirm != FRASE_EXCLUSAO {
        return Err(AppError::new(ErrorCode::ConfirmationPhraseRequired));
    }
    let id = usuario.0.clone();

    let equipes: Vec<(String, String, String, i64)> = state.db.with({ let id = id.clone(); move |conn| {
        let mut stmt = conn.prepare("SELECT e.id, e.nome, m.cargo, (SELECT COUNT(*) FROM membro_equipe x WHERE x.equipe_id = e.id) FROM equipe e JOIN membro_equipe m ON m.equipe_id = e.id WHERE m.usuario_id = ?1")?;
        let linhas = stmt.query_map([&id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<Result<Vec<_>, _>>()?;
        Ok(linhas)
    } }).await?;
    if let Some((_, nome, _, _)) = equipes.iter().find(|(_, _, cargo, total)| cargo == "dono" && *total > 1) {
        return Err(AppError::new(ErrorCode::Conflict).with_message(format!("Você é dono da equipe \"{nome}\", que tem outras pessoas. Transfira a propriedade para outra pessoa (ou exclua a equipe) antes de excluir sua conta.")));
    }

    // O Cofre primeiro: se ele não puder ser apagado, nada mais é tocado e a pessoa pode tentar de novo.
    if state.config.vault_enabled {
        let resp = state.http.post(format!("{}/vault/reset", state.config.vault_internal_url)).json(&serde_json::json!({ "confirm": FRASE_RESET_COFRE })).send().await;
        if !matches!(&resp, Ok(r) if r.status().is_success()) {
            tracing::error!(resposta = ?resp.map(|r| r.status()), "exclusão de conta: reset do Cofre falhou");
            return Err(AppError::new(ErrorCode::InternalError).with_message("Não foi possível apagar o Cofre agora. Nenhum dado foi removido — desbloqueie o Cofre e tente de novo."));
        }
    }

    // Itens criados por ela em equipes (antes do UPDATE que zera a autoria no banco).
    let autorais: Vec<String> = state.db.with({ let id = id.clone(); move |conn| {
        let mut stmt = conn.prepare("SELECT caminho_arquivo FROM nota WHERE criado_por = ?1 AND espaco != 'pessoal' UNION ALL SELECT caminho_arquivo FROM tarefa WHERE criado_por = ?1 AND espaco != 'pessoal' UNION ALL SELECT caminho_arquivo FROM evento WHERE criado_por = ?1 AND espaco != 'pessoal'")?;
        let linhas = stmt.query_map([&id], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
        Ok(linhas)
    } }).await?;

    let sozinhas: Vec<String> = equipes.iter().filter(|(_, _, _, total)| *total <= 1).map(|(eid, ..)| eid.clone()).collect();
    let espacos_removidos: Vec<(String, PathBuf)> = crate::espacos::listar(&state.config.notes_root).into_iter().filter(|(e, _)| e.strip_prefix("equipe:").is_some_and(|eid| sozinhas.iter().any(|s| s == eid))).collect();

    state.db.with({ let (id, sozinhas) = (id.clone(), sozinhas.clone()); move |conn| {
        let tx = conn.unchecked_transaction()?;
        for equipe in &sozinhas { tx.execute("DELETE FROM equipe WHERE id = ?1", [equipe])?; }
        for tabela in ["membro_equipe", "notificacao", "dispositivo", "config_sync", "config_calendario", "perfil_rotina", "sessao"] {
            tx.execute(&format!("DELETE FROM {tabela} WHERE usuario_id = ?1"), [&id])?;
        }
        for tabela in ["nota", "tarefa", "evento"] { tx.execute(&format!("UPDATE {tabela} SET criado_por = NULL WHERE criado_por = ?1"), [&id])?; }
        tx.execute("DELETE FROM usuario WHERE id = ?1", [&id])?;
        tx.commit()
    } }).await?;

    let mut avisos = Vec::new();
    remover(&state.config.notes_root.join(crate::espacos::PESSOAL_DIR), &mut avisos);
    for (_, dir) in &espacos_removidos { remover(dir, &mut avisos); }
    crate::routes::avatar::remover_todos(&state, &id);
    anonimizar_front_matter(&state.config.notes_root, &autorais, &id, &mut avisos);
    limpar_lixeira(&state, &espacos_removidos, &mut avisos);
    if let Err(e) = crate::db::reindex::reindexar_tudo(&state.db, &state.config.notes_root).await {
        tracing::error!(error = %e, "reindex após exclusão de conta falhou");
        avisos.push("O índice de busca será refeito no próximo início do servidor.".into());
    }

    let jar = jar
        .add(session::cookie_sessao_expirado(state.config.cookie_secure))
        .add(session::cookie_refresh_expirado(state.config.cookie_secure));
    Ok((jar, Json(serde_json::json!({ "ok": true, "avisos": avisos }))))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{auth::password, config::{Ambiente, Config}, db::IndexDb};
    use axum::{body::{to_bytes, Body}, http::{Request, StatusCode}};
    use std::sync::{Arc, Mutex};
    use tower::Service;

    /// Lê o diretório central e confere o CRC de cada entrada: devolve `(nome, conteúdo)`.
    fn ler_zip(bytes: &[u8]) -> Vec<(String, Vec<u8>)> {
        let u16_ = |o: usize| u16::from_le_bytes([bytes[o], bytes[o + 1]]) as usize;
        let u32_ = |o: usize| u32::from_le_bytes(bytes[o..o + 4].try_into().unwrap()) as usize;
        let eocd = bytes.len() - 22;
        assert_eq!(u32_(eocd), 0x0605_4B50);
        let (total, mut o) = (u16_(eocd + 10), u32_(eocd + 16));
        let mut saida = Vec::new();
        for _ in 0..total {
            assert_eq!(u32_(o), 0x0201_4B50);
            let (crc, tam, nome_len, local) = (u32_(o + 16) as u32, u32_(o + 24), u16_(o + 28), u32_(o + 42));
            let nome = String::from_utf8(bytes[o + 46..o + 46 + nome_len].to_vec()).unwrap();
            assert_eq!(u32_(local), 0x0403_4B50);
            let dados_ini = local + 30 + u16_(local + 26) + u16_(local + 28);
            let dados = bytes[dados_ini..dados_ini + tam].to_vec();
            assert_eq!(crate::zip::crc32(&dados), crc, "CRC de {nome}");
            saida.push((nome, dados));
            o += 46 + nome_len;
        }
        saida
    }

    #[tokio::test]
    async fn membro_sai_da_equipe_mas_dono_com_outras_pessoas_e_unico_integrante_sao_barrados() {
        let temp = std::env::temp_dir().join(format!("ecos-sair-test-{}", new_id()));
        std::fs::create_dir_all(&temp).unwrap();
        let segredo = b"segredo-efemero-exclusivo-do-teste".to_vec();
        let state = AppState {
            db: IndexDb::open(&temp.join("index.db")).unwrap(),
            config: Arc::new(Config {
                ambiente: Ambiente::Desenvolvimento, porta: 0, notes_root: temp.clone(), index_db_path: temp.join("index.db"),
                vault_enabled: false, vault_internal_url: String::new(), session_secret: segredo.clone(),
                ranking_interval_secs: 300, static_dir: None, cookie_secure: false, google: None,
            }),
            http: reqwest::Client::new(), pareamentos: Arc::new(Mutex::new(Default::default())),
        };
        state.db.with(|c| {
            for u in ["u1", "u2"] { c.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash) VALUES (?1, ?1, 'x', 'x')", [u])?; }
            c.execute("INSERT INTO equipe (id, nome) VALUES ('EQ', 'Casa')", [])?;
            c.execute("INSERT INTO membro_equipe (equipe_id, usuario_id, cargo) VALUES ('EQ', 'u2', 'dono'), ('EQ', 'u1', 'membro')", [])?;
            Ok(())
        }).await.unwrap();
        let app = crate::routes::montar(state.clone());
        let sair = |u: &str| {
            let t = crate::auth::session::emitir_access_token(u, &segredo).unwrap();
            Request::post("/api/v1/equipes/EQ/sair").header("authorization", format!("Bearer {t}")).body(Body::empty()).unwrap()
        };
        assert_eq!(app.clone().call(sair("u2")).await.unwrap().status(), StatusCode::CONFLICT, "dono com outra pessoa precisa transferir");
        assert_eq!(app.clone().call(sair("u1")).await.unwrap().status(), StatusCode::OK);
        let restam: i64 = state.db.with(|c| c.query_row("SELECT COUNT(*) FROM membro_equipe WHERE equipe_id = 'EQ'", [], |r| r.get(0))).await.unwrap();
        assert_eq!(restam, 1);
        assert_eq!(app.clone().call(sair("u1")).await.unwrap().status(), StatusCode::FORBIDDEN, "quem já saiu não é membro");
        assert_eq!(app.clone().call(sair("u2")).await.unwrap().status(), StatusCode::CONFLICT, "única pessoa deve excluir a equipe");
        let _ = std::fs::remove_dir_all(&temp);
    }

    #[tokio::test]
    async fn exporta_zip_real_e_exclusao_remove_conta_sessoes_arquivos_e_bloqueia_reentrada() {
        let temp = std::env::temp_dir().join(format!("ecos-conta-test-{}", new_id()));
        std::fs::create_dir_all(&temp).unwrap();
        let segredo = b"segredo-efemero-exclusivo-do-teste".to_vec();
        let state = AppState {
            db: IndexDb::open(&temp.join("index.db")).unwrap(),
            config: Arc::new(Config {
                ambiente: Ambiente::Desenvolvimento, porta: 0, notes_root: temp.clone(), index_db_path: temp.join("index.db"),
                vault_enabled: false, vault_internal_url: String::new(), session_secret: segredo.clone(),
                ranking_interval_secs: 300, static_dir: None, cookie_secure: false, google: None,
            }),
            http: reqwest::Client::new(), pareamentos: Arc::new(Mutex::new(Default::default())),
        };
        let senha_hash = password::hash("senha-correta-123").unwrap();
        state.db.with(move |conn| {
            conn.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash) VALUES ('u1', 'ana', ?1, 'x')", [&senha_hash])?;
            conn.execute("INSERT INTO usuario (id, nome_usuario, senha_hash, recovery_key_hash) VALUES ('u2', 'bia', 'x', 'x')", [])?;
            // Equipe A: só a Ana (some junto). Equipe B: Ana é membro e a Bia é dona (continua, sem a Ana).
            conn.execute("INSERT INTO equipe (id, nome) VALUES ('EQA', 'Equipe A'), ('EQB', 'Equipe B')", [])?;
            conn.execute("INSERT INTO membro_equipe (equipe_id, usuario_id, cargo) VALUES ('EQA', 'u1', 'dono'), ('EQB', 'u2', 'dono'), ('EQB', 'u1', 'membro')", [])?;
            Ok(())
        }).await.unwrap();
        let app = crate::routes::montar(state.clone());
        let token = crate::auth::session::emitir_access_token("u1", &segredo).unwrap();
        let auth = format!("Bearer {token}");

        let json = |metodo: &str, uri: &str, corpo: &str| Request::builder().method(metodo).uri(uri).header("authorization", &auth).header("content-type", "application/json").body(Body::from(corpo.to_string())).unwrap();
        let nota = app.clone().call(json("POST", "/api/v1/notas", r#"{"titulo":"Minha nota","corpo":"conteudo pessoal"}"#)).await.unwrap();
        assert_eq!(nota.status(), StatusCode::OK);
        let tarefa = app.clone().call(json("POST", "/api/v1/tarefas", r#"{"titulo":"Minha tarefa"}"#)).await.unwrap();
        assert_eq!(tarefa.status(), StatusCode::OK);
        let mut corpo = b"--x\r\nContent-Disposition: form-data; name=\"arquivo\"; filename=\"anexo.pdf\"\r\nContent-Type: application/pdf\r\n\r\n".to_vec();
        corpo.extend_from_slice(&[7u8; 5000]);
        corpo.extend_from_slice(b"\r\n--x--\r\n");
        let up = app.clone().call(Request::post("/api/v1/media").header("authorization", &auth).header("content-type", "multipart/form-data; boundary=x").body(Body::from(corpo)).unwrap()).await.unwrap();
        assert_eq!(up.status(), StatusCode::OK);
        // Item que a Ana criou em equipe com outra dona, mais um item da Bia que NÃO pode vazar para o zip da Ana.
        let dir_b = crate::espacos::garantir_dir(&temp, "equipe:EQB", Some("Equipe B")).unwrap();
        std::fs::create_dir_all(dir_b.join("Notas")).unwrap();
        let fm = |id: &str, por: &str| format!("---\nid: {id}\ntitulo: {id}\nmodo: texto\nespaco: equipe:EQB\ntags: []\ncriado_em: 2026-01-01T00:00:00Z\natualizado_em: 2026-01-01T00:00:00Z\ncriado_por: {por}\n---\ncorpo\n");
        std::fs::write(dir_b.join("Notas/da-ana.md"), fm("01M2ZC20AAAAAAAAAAAAAAAAAA", "u1")).unwrap();
        std::fs::write(dir_b.join("Notas/da-bia.md"), fm("01M2ZC20BBBBBBBBBBBBBBBBBB", "u2")).unwrap();
        let dir_a = crate::espacos::garantir_dir(&temp, "equipe:EQA", Some("Equipe A")).unwrap();
        std::fs::create_dir_all(dir_a.join("Notas")).unwrap();
        std::fs::write(dir_a.join("Notas/so-da-a.md"), "x").unwrap();
        crate::db::reindex::reindexar_tudo(&state.db, &temp).await.unwrap();
        let avatar_dir = temp.join(".ecos/avatares");
        std::fs::create_dir_all(&avatar_dir).unwrap();
        std::fs::write(avatar_dir.join("u1.png"), [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]).unwrap();

        // --- Exportação: zip de verdade, com CRCs corretos.
        let exp = app.clone().call(Request::get("/api/v1/me/export").header("authorization", &auth).body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(exp.status(), StatusCode::OK);
        assert_eq!(exp.headers()["content-type"], "application/zip");
        assert!(exp.headers()["content-disposition"].to_str().unwrap().starts_with("attachment; filename=\"ecos-exportacao-"));
        let zip = to_bytes(exp.into_body(), 1 << 20).await.unwrap();
        if let Ok(destino) = std::env::var("ECOS_TEST_ZIP_OUT") { std::fs::write(destino, &zip).unwrap(); } // conferência com leitor externo (python -m zipfile)
        let itens = ler_zip(&zip);
        let nomes: Vec<&str> = itens.iter().map(|(n, _)| n.as_str()).collect();
        assert!(nomes.contains(&"manifesto.json") && nomes.contains(&"LEIA-ME.txt"));
        assert!(nomes.iter().any(|n| n.starts_with("Pessoal/Notas/") && n.ends_with(".md")), "notas: {nomes:?}");
        assert!(nomes.iter().any(|n| n.starts_with("Pessoal/Tarefas/") && n.ends_with(".md")), "tarefas: {nomes:?}");
        assert!(itens.iter().any(|(n, d)| n.starts_with("Pessoal/src/Media/") && d.as_slice() == &[7u8; 5000][..]), "anexo íntegro: {nomes:?}");
        assert!(nomes.contains(&"perfil/avatar.png"));
        assert!(nomes.iter().any(|n| n.ends_with("da-ana.md")), "item que ela criou na equipe: {nomes:?}");
        assert!(!nomes.iter().any(|n| n.ends_with("da-bia.md") || n.ends_with("so-da-a.md")), "não vaza item de outra pessoa: {nomes:?}");
        assert!(std::fs::read_dir(temp.join(".ecos/tmp")).unwrap().next().is_none(), "sem temporário sobrando");

        // --- Exclusão: frase errada não faz nada; sessão real existe antes.
        let login = app.clone().call(json("POST", "/api/v1/auth/login", r#"{"usuario":"ana","senha":"senha-correta-123"}"#)).await.unwrap();
        assert_eq!(login.status(), StatusCode::OK);
        let cookies: Vec<String> = login.headers().get_all("set-cookie").iter().map(|v| v.to_str().unwrap().split(';').next().unwrap().to_string()).collect();
        let sessoes: i64 = state.db.with(|c| c.query_row("SELECT COUNT(*) FROM sessao WHERE usuario_id = 'u1'", [], |r| r.get(0))).await.unwrap();
        assert_eq!(sessoes, 1);
        let errada = app.clone().call(json("DELETE", "/api/v1/me", r#"{"confirm":"excluir conta"}"#)).await.unwrap();
        assert!(errada.status().is_client_error());
        assert!(temp.join("Pessoal").exists(), "frase errada não apaga nada");

        // Dono de equipe com outras pessoas é barrado (aqui a Ana vira dona da Equipe B, que tem a Bia).
        state.db.with(|c| c.execute("UPDATE membro_equipe SET cargo = 'dono' WHERE equipe_id = 'EQB' AND usuario_id = 'u1'", [])).await.unwrap();
        let barrada = app.clone().call(json("DELETE", "/api/v1/me", r#"{"confirm":"EXCLUIR CONTA"}"#)).await.unwrap();
        assert_eq!(barrada.status(), StatusCode::CONFLICT);
        assert!(temp.join("Pessoal").exists());
        state.db.with(|c| c.execute("UPDATE membro_equipe SET cargo = 'membro' WHERE equipe_id = 'EQB' AND usuario_id = 'u1'", [])).await.unwrap();

        let del = app.clone().call(json("DELETE", "/api/v1/me", r#"{"confirm":"EXCLUIR CONTA"}"#)).await.unwrap();
        assert_eq!(del.status(), StatusCode::OK);
        let limpos: Vec<String> = del.headers().get_all("set-cookie").iter().map(|v| v.to_str().unwrap().to_lowercase()).collect();
        assert!(limpos.iter().any(|c| c.starts_with("ecos_sessao=") && (c.contains("max-age=0") || c.contains("1970"))), "cookie de sessão expirado: {limpos:?}");
        assert!(limpos.iter().any(|c| c.starts_with("ecos_refresh=") && (c.contains("max-age=0") || c.contains("1970"))), "cookie de refresh expirado: {limpos:?}");

        // Banco.
        let (usuario, membros_u1, sess): (i64, i64, i64) = state.db.with(|c| Ok((
            c.query_row("SELECT COUNT(*) FROM usuario WHERE id = 'u1'", [], |r| r.get(0))?,
            c.query_row("SELECT COUNT(*) FROM membro_equipe WHERE usuario_id = 'u1'", [], |r| r.get(0))?,
            c.query_row("SELECT COUNT(*) FROM sessao WHERE usuario_id = 'u1'", [], |r| r.get(0))?,
        ))).await.unwrap();
        assert_eq!((usuario, membros_u1, sess), (0, 0, 0));
        let (equipes, notas_pessoais, tarefas_pessoais, autor): (Option<String>, i64, i64, Option<String>) = state.db.with(|c| Ok((
            c.query_row("SELECT group_concat(id) FROM equipe", [], |r| r.get(0))?,
            c.query_row("SELECT COUNT(*) FROM nota WHERE espaco = 'pessoal'", [], |r| r.get(0))?,
            c.query_row("SELECT COUNT(*) FROM tarefa WHERE espaco = 'pessoal'", [], |r| r.get(0))?,
            c.query_row("SELECT criado_por FROM nota WHERE id = '01M2ZC20AAAAAAAAAAAAAAAAAA'", [], |r| r.get(0))?,
        ))).await.unwrap();
        assert_eq!(equipes.as_deref(), Some("EQB"), "equipe só dela some; a outra continua");
        assert_eq!((notas_pessoais, tarefas_pessoais), (0, 0));
        assert_eq!(autor, None, "item na equipe que continua fica, sem autoria");

        // Arquivos.
        assert!(!temp.join("Pessoal").exists(), "espaço Pessoal apagado");
        assert!(!dir_a.exists(), "equipe em que era a única pessoa apagada");
        assert!(!avatar_dir.join("u1.png").exists(), "avatar apagado");
        assert!(dir_b.join("Notas/da-bia.md").exists() && dir_b.join("Notas/da-ana.md").exists(), "equipe que continua preserva o histórico");
        let da_ana = std::fs::read_to_string(dir_b.join("Notas/da-ana.md")).unwrap();
        assert!(!da_ana.contains("u1") && da_ana.contains("criado_por: null") && da_ana.contains("corpo"), "ID sai do front-matter, o conteúdo fica: {da_ana}");
        assert!(std::fs::read_to_string(dir_b.join("Notas/da-bia.md")).unwrap().contains("criado_por: u2"), "autoria de outras pessoas intacta");

        // Reentrada: nem o token antigo, nem o refresh antigo, nem a senha funcionam.
        let mesmo_token = app.clone().call(Request::get("/api/v1/me").header("authorization", &auth).body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(mesmo_token.status(), StatusCode::UNAUTHORIZED, "access token antigo não vale");
        let refresh = cookies.iter().find(|c| c.starts_with("ecos_refresh=")).unwrap().clone();
        let renovar = app.clone().call(Request::post("/api/v1/auth/refresh").header("cookie", refresh).body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(renovar.status(), StatusCode::UNAUTHORIZED, "refresh antigo não vale");
        let relogin = app.clone().call(json("POST", "/api/v1/auth/login", r#"{"usuario":"ana","senha":"senha-correta-123"}"#)).await.unwrap();
        assert_eq!(relogin.status(), StatusCode::UNAUTHORIZED, "login com a conta excluída falha");
        let _ = std::fs::remove_dir_all(&temp);
    }
}
