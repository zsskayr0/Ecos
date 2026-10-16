//! Problemas de sincronização por item: o que o Google recusou, em palavras claras, e o que a pessoa pode fazer.
//!
//! Só texto legível e códigos curtos são guardados: nunca token, nunca o corpo da resposta do Google. A mensagem do
//! Google (`motivo_google`) é truncada e serve só de apoio ao texto traduzido daqui.

use super::google::GoogleErro;
use rusqlite::{params, Connection};

const CONFLITO_NOTIFICA_NA_TENTATIVA: i64 = 3;
pub const ROTA_RESOLUCAO: &str = "/configuracoes/calendario/problemas";

/// Texto e ações para um código de problema.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Descricao {
    pub titulo: &'static str,
    pub explicacao: &'static str,
    /// Ações oferecidas na tela (`tentar_de_novo`, `abrir`, `manter_local`, `manter_google`, `manter_ambos`,
    /// `desvincular`, `ignorar`, `reautorizar`). As destrutivas exigem confirmação no servidor.
    pub acoes: Vec<&'static str>,
}

/// Código estável do problema a partir do erro do Google. `None` = não é problema do item (rede, limite de uso,
/// token): quem trata é o ciclo, com nova tentativa ou reautorização.
pub fn codigo_do_erro(e: &GoogleErro) -> Option<&'static str> {
    match e {
        GoogleErro::PreCondicao => Some("conflito_edicao"),
        GoogleErro::NaoEncontrado | GoogleErro::Gone => Some("removido_no_google"),
        GoogleErro::Http { status, razao, mensagem } => {
            let texto = format!("{razao} {mensagem}").to_lowercase();
            match status {
                429 | 500..=599 => None,
                403 if ["ratelimit", "quotaexceeded", "dailylimit"].iter().any(|t| texto.contains(t)) => None,
                403 | 401 => Some(if texto.contains("insufficient") || texto.contains("scope") { "permissao_insuficiente" } else { "sem_permissao" }),
                400 if texto.contains("recurrence") || texto.contains("rrule") => Some("recorrencia_nao_suportada"),
                400 | 422 => Some("evento_invalido"),
                409 => Some("conflito_edicao"),
                _ => Some("erro_google"),
            }
        }
        GoogleErro::InvalidGrant | GoogleErro::TokenRecusado | GoogleErro::Rede(_) => None,
    }
}

pub fn descrever(codigo: &str, item_tipo: &str) -> Descricao {
    let mut d = descrever_base(codigo, item_tipo);
    if item_tipo == "exclusao" {
        // Uma exclusão pendente não tem evento local para abrir, sobrescrever ou desvincular.
        d.acoes.retain(|a| ["tentar_de_novo", "ignorar", "reautorizar"].contains(a));
    }
    d
}

fn descrever_base(codigo: &str, item_tipo: &str) -> Descricao {
    let exclusao = item_tipo == "exclusao";
    match codigo {
        "conflito_edicao" => Descricao {
            titulo: "Editado nos dois lugares",
            explicacao: "Este evento foi alterado no Google e aqui ao mesmo tempo. Nada foi sobrescrito. Escolha qual versão vale, ou guarde as duas.",
            acoes: vec!["abrir", "manter_ambos", "manter_local", "manter_google", "ignorar"],
        },
        "sem_permissao" => Descricao {
            titulo: "Sem permissão para alterar no Google",
            explicacao: "O Google não deixou gravar este evento: o calendário pode ser somente leitura ou você não pode editar este evento. Reautorizar não resolve se a permissão é do calendário. Mantenha a versão do Google ou desvincule o evento.",
            acoes: if exclusao { vec!["tentar_de_novo", "ignorar"] } else { vec!["tentar_de_novo", "abrir", "manter_google", "desvincular", "ignorar"] },
        },
        "permissao_insuficiente" => Descricao {
            titulo: "Permissão do app insuficiente",
            explicacao: "O acesso concedido ao Ecos não inclui alterar eventos. Reautorize a conta aceitando a permissão de editar o calendário.",
            acoes: vec!["reautorizar", "tentar_de_novo", "ignorar"],
        },
        "evento_invalido" => Descricao {
            titulo: "O Google recusou os dados do evento",
            explicacao: "Alguma informação do evento (data, horário, duração ou texto) não é aceita pelo Google. Abra o evento, revise e tente de novo.",
            acoes: vec!["abrir", "tentar_de_novo", "manter_google", "desvincular", "ignorar"],
        },
        "recorrencia_nao_suportada" => Descricao {
            titulo: "Repetição não aceita pelo Google",
            explicacao: "A regra de repetição deste evento não é aceita pelo Google. Simplifique a repetição no evento ou mantenha-o só no Ecos.",
            acoes: vec!["abrir", "tentar_de_novo", "desvincular", "ignorar"],
        },
        "removido_no_google" => Descricao {
            titulo: "Não existe mais no Google",
            explicacao: if exclusao { "O evento já não existe no Google; não há o que apagar lá." } else { "O evento foi apagado no Google. Mantenha a versão daqui (ele será recriado) ou desvincule-o para ficar só no Ecos." },
            acoes: if exclusao { vec!["ignorar"] } else { vec!["manter_local", "desvincular", "ignorar"] },
        },
        _ => Descricao {
            titulo: "O Google devolveu um erro",
            explicacao: "O Google recusou esta operação por um motivo não previsto. Tente de novo; se persistir, desvincule o item ou ignore o problema.",
            acoes: if exclusao { vec!["tentar_de_novo", "ignorar"] } else { vec!["tentar_de_novo", "abrir", "desvincular", "ignorar"] },
        },
    }
}

/// Registra (ou soma uma tentativa a) um problema. Devolve o id quando gravou a notificação (uma vez por abertura;
/// conflito de edição só na 3ª tentativa seguida, porque costuma se resolver sozinho).
#[allow(clippy::too_many_arguments)]
pub fn registrar(conn: &Connection, usuario_id: &str, item_tipo: &str, item_id: &str, item_titulo: &str, direcao: &str, operacao: &str, codigo: &str, status: Option<u16>, motivo_google: &str) -> rusqlite::Result<Option<String>> {
    let agora = chrono::Utc::now().to_rfc3339();
    let motivo: String = motivo_google.chars().take(200).collect();
    let atual: Option<(String, String)> = conn
        .query_row(
            "SELECT id, estado FROM sync_problema WHERE usuario_id = ?1 AND provider = 'google' AND item_tipo = ?2 AND item_id = ?3 AND operacao = ?4",
            params![usuario_id, item_tipo, item_id, operacao],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    let (id, tentativas, notificar_agora) = match atual {
        Some((id, estado)) if estado != "resolvido" => {
            conn.execute(
                "UPDATE sync_problema SET tentativas = tentativas + 1, ultima_vez = ?1, codigo = ?2, http_status = ?3, motivo_google = ?4, item_titulo = ?5 WHERE id = ?6",
                params![agora, codigo, status, motivo, item_titulo, id],
            )?;
            let t: i64 = conn.query_row("SELECT tentativas FROM sync_problema WHERE id = ?1", [&id], |r| r.get(0))?;
            // Conflito de edição costuma se resolver sozinho no ciclo seguinte: só avisa se persistir.
            let avisa = estado == "aberto" && codigo == "conflito_edicao" && t == CONFLITO_NOTIFICA_NA_TENTATIVA;
            (id, t, avisa)
        }
        Some((id, _)) => {
            conn.execute(
                "UPDATE sync_problema SET estado = 'aberto', tentativas = 1, primeira_vez = ?1, ultima_vez = ?1, codigo = ?2, http_status = ?3, motivo_google = ?4, item_titulo = ?5 WHERE id = ?6",
                params![agora, codigo, status, motivo, item_titulo, id],
            )?;
            (id, 1, codigo != "conflito_edicao")
        }
        None => {
            let id = ecos_core::new_id();
            conn.execute(
                "INSERT INTO sync_problema (id, usuario_id, provider, item_tipo, item_id, item_titulo, direcao, operacao, codigo, http_status, motivo_google, primeira_vez, ultima_vez)                  VALUES (?1, ?2, 'google', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
                params![id, usuario_id, item_tipo, item_id, item_titulo, direcao, operacao, codigo, status, motivo, agora],
            )?;
            (id, 1, codigo != "conflito_edicao")
        }
    };
    let _ = tentativas;
    if !notificar_agora {
        return Ok(None);
    }
    let primeira: String = conn.query_row("SELECT primeira_vez FROM sync_problema WHERE id = ?1", [&id], |r| r.get(0))?;
    let d = descrever(codigo, item_tipo);
    let titulo_item: String = item_titulo.chars().take(80).collect();
    crate::routes::notificacoes::criar_com_acao(
        conn,
        usuario_id,
        "sync",
        "Problema ao sincronizar com o Google",
        &format!("\"{titulo_item}\": {}", d.titulo),
        Some(&format!("sync-problema:{id}:{primeira}")),
        Some(ROTA_RESOLUCAO),
    )?;
    Ok(Some(id))
}

/// Marca como resolvidos os problemas de envio abertos que este ciclo não tocou (o item foi enviado ou deixou de
/// estar pendente). Só chamar quando o ciclo percorreu todos os pendentes. Devolve quantos foram resolvidos.
pub fn resolver_nao_tocados(conn: &Connection, usuario_id: &str, desde: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE sync_problema SET estado = 'resolvido' WHERE usuario_id = ?1 AND provider = 'google' AND direcao = 'envio' AND estado IN ('aberto', 'ignorado') AND ultima_vez < ?2",
        params![usuario_id, desde],
    )
}

pub fn abertos(conn: &Connection, usuario_id: &str) -> rusqlite::Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM sync_problema WHERE usuario_id = ?1 AND provider = 'google' AND estado = 'aberto'", [usuario_id], |r| r.get(0))
}

#[cfg(test)]
mod testes {
    use super::*;

    fn http(status: u16, razao: &str, msg: &str) -> GoogleErro {
        GoogleErro::Http { status, razao: razao.into(), mensagem: msg.into() }
    }

    #[test]
    fn classifica_os_erros_comuns_do_google() {
        assert_eq!(codigo_do_erro(&GoogleErro::PreCondicao), Some("conflito_edicao"));
        assert_eq!(codigo_do_erro(&http(403, "forbidden", "Forbidden")), Some("sem_permissao"));
        assert_eq!(codigo_do_erro(&http(403, "insufficientPermissions", "Insufficient Permission")), Some("permissao_insuficiente"));
        assert_eq!(codigo_do_erro(&http(400, "invalid", "Invalid value for: start")), Some("evento_invalido"));
        assert_eq!(codigo_do_erro(&http(400, "invalid", "Invalid recurrence rule")), Some("recorrencia_nao_suportada"));
        assert_eq!(codigo_do_erro(&GoogleErro::NaoEncontrado), Some("removido_no_google"));
        assert_eq!(codigo_do_erro(&http(418, "x", "y")), Some("erro_google"));
        // Limite de taxa, 5xx, rede e token não são problema do item.
        assert_eq!(codigo_do_erro(&http(403, "rateLimitExceeded", "Rate Limit Exceeded")), None);
        assert_eq!(codigo_do_erro(&http(429, "rateLimitExceeded", "")), None);
        assert_eq!(codigo_do_erro(&http(503, "backendError", "")), None);
        assert_eq!(codigo_do_erro(&GoogleErro::Rede("x".into())), None);
        assert_eq!(codigo_do_erro(&GoogleErro::InvalidGrant), None);
    }

    #[test]
    fn todo_codigo_tem_texto_e_acoes_coerentes() {
        for c in ["conflito_edicao", "sem_permissao", "permissao_insuficiente", "evento_invalido", "recorrencia_nao_suportada", "removido_no_google", "erro_google"] {
            for tipo in ["evento", "exclusao"] {
                let d = descrever(c, tipo);
                assert!(!d.titulo.is_empty() && !d.explicacao.is_empty() && d.acoes.contains(&"ignorar"), "{c}/{tipo}");
                if tipo == "exclusao" {
                    assert!(!d.acoes.iter().any(|a| ["abrir", "manter_local", "manter_google", "manter_ambos", "desvincular"].contains(a)), "{c}: exclusão não tem item para abrir");
                }
            }
        }
    }
}
