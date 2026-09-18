//! Tipos de domínio — um `struct`/`enum` por entidade da seção 1.3 do
//! documento de arquitetura. Servem tanto de linha de banco (índice local e
//! Vault) quanto de payload de API (seção 11) — o contrato é deliberadamente
//! o mesmo, ver seção 11.1.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

/// `espaco`: `pessoal` ou `equipe:<id>` (seção 1.3). Modelado como enum em
/// vez de `String` livre para que "espaço inválido" seja impossível de
/// representar depois do parse — validação acontece uma vez, na borda.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub enum Espaco {
    Pessoal,
    Equipe(String),
}

impl fmt::Display for Espaco {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Espaco::Pessoal => write!(f, "pessoal"),
            Espaco::Equipe(id) => write!(f, "equipe:{id}"),
        }
    }
}

impl FromStr for Espaco {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        if s == "pessoal" {
            Ok(Espaco::Pessoal)
        } else if let Some(id) = s.strip_prefix("equipe:") {
            if id.is_empty() {
                Err(format!("espaco de equipe sem id: {s:?}"))
            } else {
                Ok(Espaco::Equipe(id.to_string()))
            }
        } else {
            Err(format!("espaco invalido: {s:?} (esperado 'pessoal' ou 'equipe:<id>')"))
        }
    }
}

impl TryFrom<String> for Espaco {
    type Error = String;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        value.parse()
    }
}

impl From<Espaco> for String {
    fn from(value: Espaco) -> Self {
        value.to_string()
    }
}

// ---------------------------------------------------------------------
// Nota / Tarefa / Pasta / Documento (seção 1.3)
// ---------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotaModo {
    Texto,
    Pagina,
}

impl Default for NotaModo {
    fn default() -> Self {
        NotaModo::Texto
    }
}

/// Front-matter YAML da Nota (front-matter da seção 1.3) — é isto que
/// `frontmatter::parse` deserializa a partir do bloco `---` do `.md`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotaFrontMatter {
    pub id: String,
    pub titulo: String,
    #[serde(default)]
    pub modo: NotaModo,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
    #[serde(default)]
    pub tags: Vec<String>,
    /// caminho relativo da pasta pai sob `Notas/`; `None` = raiz.
    #[serde(default)]
    pub pasta_id: Option<String>,
    pub espaco: Espaco,
    #[serde(default)]
    pub tarefa_vinculada_id: Option<String>,
    #[serde(default)]
    pub ultima_revisao_em: Option<DateTime<Utc>>,
    /// `usuario_id` de quem criou — sempre o único usuário local em
    /// `espaco: pessoal`, mas em `espaco: equipe:*` pode ser qualquer
    /// membro (feedback do usuário: "no feed, deve ter a foto de perfil e
    /// o nome do dono daquele item"). `None` só em itens criados antes
    /// desta coluna existir (migration 0003) — nunca inventado depois.
    #[serde(default)]
    pub criado_por: Option<String>,
}

/// Linha do índice local para Nota (cache derivado — seção 1.1/1.3).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotaIndexada {
    pub id: String,
    pub caminho_arquivo: String,
    pub titulo: String,
    pub modo: NotaModo,
    pub pasta_id: Option<String>,
    pub espaco: Espaco,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
    pub ultima_revisao_em: Option<DateTime<Utc>>,
    pub hash_conteudo: String,
    pub contagem_links_entrada: i64,
    pub contagem_acessos_7d: i64,
    #[serde(default)]
    pub ocr_texto_busca: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TarefaStatus {
    Pendente,
    Concluida,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CalendarioProvider {
    Google,
    Microsoft,
}

/// Vínculo com evento de calendário externo, embutido no front-matter da
/// Tarefa (seção 1.3 / 6.5).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EventoExternoRef {
    #[serde(default)]
    pub provider: Option<CalendarioProvider>,
    #[serde(default)]
    pub event_id: Option<String>,
    #[serde(default)]
    pub synced_at: Option<DateTime<Utc>>,
}

/// Prioridade da Tarefa — além de orientar o usuário, alimenta o boost de
/// score que a insere no Feed (seção 4, `ecos_core::ranking::boost_tarefa_prioridade`):
/// o Feed "casualmente mostra tarefas, como se fossem ads" (handoff de
/// front-end) e prioridade é o que decide o quão forte esse anúncio é.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TarefaPrioridade {
    Baixa,
    Media,
    Alta,
}

impl Default for TarefaPrioridade {
    fn default() -> Self {
        TarefaPrioridade::Media
    }
}

/// Subtarefa — item de checklist estruturado da Tarefa, distinto do corpo
/// Markdown livre (que também aceita `- [ ]`, mas sem progresso rastreável
/// por item). Vive no front-matter, não em tabela própria — mesmo
/// tratamento que `tags` já recebe.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subtarefa {
    pub id: String,
    pub titulo: String,
    #[serde(default)]
    pub concluida: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TarefaFrontMatter {
    pub id: String,
    pub titulo: String,
    pub status: TarefaStatus,
    #[serde(default)]
    pub scheduled_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub duration_min: Option<i64>,
    #[serde(default)]
    pub due_date: Option<NaiveDate>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub prioridade: TarefaPrioridade,
    #[serde(default)]
    pub subtarefas: Vec<Subtarefa>,
    pub espaco: Espaco,
    #[serde(default)]
    pub evento_externo: EventoExternoRef,
    pub criado_em: DateTime<Utc>,
    /// Última edição (criação, PATCH ou mudança de status). Ausente em arquivos antigos — o índice usa o mtime do arquivo até a próxima edição.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub atualizado_em: Option<DateTime<Utc>>,
    /// See `NotaFrontMatter::criado_por` — same rationale, same migration.
    #[serde(default)]
    pub criado_por: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TarefaIndexada {
    pub id: String,
    pub caminho_arquivo: String,
    pub titulo: String,
    pub status: TarefaStatus,
    pub scheduled_at: Option<DateTime<Utc>>,
    pub duration_min: Option<i64>,
    pub due_date: Option<NaiveDate>,
    pub tags: Vec<String>,
    pub prioridade: TarefaPrioridade,
    pub espaco: Espaco,
    pub evento_externo: EventoExternoRef,
    pub criado_em: DateTime<Utc>,
}

/// Pasta não é entidade persistida — é derivada da árvore de diretórios a
/// cada reindex (seção 1.3/1.5). Esta struct é só a *projeção* em cache.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ArvoreTipo {
    Nota,
    Tarefa,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PastaCache {
    pub caminho: String,
    pub tipo: ArvoreTipo,
    pub nome: String,
    pub espaco: Espaco,
    pub contagem_itens: i64,
}

/// Documento (PDF) — identidade por hash de conteúdo, nunca por id (seção 1.3).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentoCache {
    pub caminho: String,
    pub nome: String,
    pub tipo: String,
    pub tamanho_bytes: i64,
    pub hash_conteudo: String,
    pub pasta: Option<String>,
    pub espaco: Espaco,
}

// ---------------------------------------------------------------------
// Feed (seção 4) — resultado do job de ranking, não é entidade de origem
// ---------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FeedItemTipo {
    Nota,
    TarefaEncaixada,
    Transacao,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FeedMotivo {
    Esquecimento,
    Orfa,
    Frescor,
    Interacao,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeedItem {
    pub id: String,
    pub tipo: FeedItemTipo,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub motivo: Option<FeedMotivo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dado_bruto: Option<serde_json::Value>,
    pub espaco: Espaco,
    pub atualizado_em: DateTime<Utc>,
}

// ---------------------------------------------------------------------
// Cofre / Vault (seção 1.3-A) — mesmos nomes de coluna do schema SQL
// ---------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CategoriaTipo {
    Entrada,
    Saida,
    Ambos,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Categoria {
    pub id: String,
    pub nome: String,
    pub tipo: CategoriaTipo,
    #[serde(default)]
    pub icone: Option<String>,
    pub cor: String,
    pub padrao: bool,
    pub espaco: Espaco,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conta {
    pub id: String,
    pub nome: String,
    #[serde(default)]
    pub banco: Option<String>,
    #[serde(default)]
    pub agencia: Option<String>,
    #[serde(default)]
    pub numero_conta: Option<String>,
    pub cor: String,
    pub espaco: Espaco,
    pub padrao: bool,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Beneficiario {
    pub id: String,
    pub nome: String,
    #[serde(default)]
    pub documento: Option<String>,
    #[serde(default)]
    pub observacoes: Option<String>,
    pub criado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransacaoTipo {
    Entrada,
    Saida,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FormaPagamento {
    Pix,
    PixAutomatico,
    Ted,
    Cartao,
    Dinheiro,
    Boleto,
    Outro,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransacaoStatus {
    Efetivada,
    Pendente,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransacaoOrigem {
    Manual,
    CapturaCamera,
    RecorrenciaGerada,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transacao {
    pub id: String,
    pub tipo: TransacaoTipo,
    /// Sempre centavos inteiros — nunca `f64` (regra não-negociável, seção 1.3).
    pub valor_centavos: i64,
    #[serde(default = "moeda_padrao")]
    pub moeda: String,
    pub data: NaiveDate,
    pub descricao: String,
    #[serde(default)]
    pub categoria_id: Option<String>,
    #[serde(default)]
    pub conta_id: Option<String>,
    #[serde(default)]
    pub beneficiario_id: Option<String>,
    #[serde(default)]
    pub forma_pagamento: Option<FormaPagamento>,
    #[serde(default = "TransacaoStatus::default_efetivada")]
    pub status: TransacaoStatus,
    #[serde(default)]
    pub observacoes: Option<String>,
    #[serde(default = "TransacaoOrigem::default_manual")]
    pub origem: TransacaoOrigem,
    #[serde(default)]
    pub ocr_texto_bruto: Option<String>,
    #[serde(default)]
    pub ocr_confianca: Option<f64>,
    #[serde(default)]
    pub transacao_recorrente_id: Option<String>,
    pub espaco: Espaco,
    pub criado_por: String,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

fn moeda_padrao() -> String {
    "BRL".to_string()
}

impl TransacaoStatus {
    fn default_efetivada() -> Self {
        TransacaoStatus::Efetivada
    }
}

impl TransacaoOrigem {
    fn default_manual() -> Self {
        TransacaoOrigem::Manual
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TipoRecorrencia {
    Fixa,
    Parcelada,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Frequencia {
    Semanal,
    Mensal,
    Anual,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransacaoRecorrente {
    pub id: String,
    pub tipo: TransacaoTipo,
    pub descricao: String,
    pub valor_centavos: i64,
    #[serde(default)]
    pub categoria_id: Option<String>,
    #[serde(default)]
    pub conta_id: Option<String>,
    #[serde(default)]
    pub beneficiario_id: Option<String>,
    #[serde(default)]
    pub forma_pagamento: Option<FormaPagamento>,
    pub tipo_recorrencia: TipoRecorrencia,
    pub frequencia: Frequencia,
    #[serde(default = "intervalo_padrao")]
    pub intervalo: i64,
    #[serde(default)]
    pub dia_vencimento: Option<i64>,
    pub data_inicio: NaiveDate,
    #[serde(default)]
    pub data_fim: Option<NaiveDate>,
    #[serde(default)]
    pub total_parcelas: Option<i64>,
    #[serde(default)]
    pub parcelas_geradas: i64,
    #[serde(default)]
    pub observacoes: Option<String>,
    pub espaco: Espaco,
    #[serde(default = "ativa_padrao")]
    pub ativa: bool,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

fn intervalo_padrao() -> i64 {
    1
}
fn ativa_padrao() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecorrenciaExclusao {
    pub transacao_recorrente_id: String,
    pub data_ocorrencia: NaiveDate,
    pub criado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Anexo {
    pub id: String,
    pub transacao_id: String,
    pub nome_arquivo: String,
    pub mime_type: String,
    pub tamanho_bytes: i64,
    pub checksum_sha256: String,
    /// `BLOB` dentro do próprio SQLCipher — nunca arquivo solto em disco
    /// (seção 1.3, "Anexo"). Omitido da serialização default (payload
    /// grande); rota dedicada de download entrega o conteúdo.
    #[serde(skip)]
    pub conteudo: Vec<u8>,
    pub criado_em: DateTime<Utc>,
}

/// Limite de tamanho de anexo, validado no backend (seção 1.3/7.3).
pub const ANEXO_TAMANHO_MAXIMO_BYTES: i64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendenciaAvulsa {
    pub id: String,
    pub tipo: TransacaoTipo,
    pub descricao: String,
    pub valor_centavos: i64,
    #[serde(default)]
    pub categoria_id: Option<String>,
    #[serde(default)]
    pub beneficiario_id: Option<String>,
    #[serde(default)]
    pub transacao_recorrente_id: Option<String>,
    #[serde(default)]
    pub observacoes: Option<String>,
    pub espaco: Espaco,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

// ---------------------------------------------------------------------
// Equipe / Membro (seção 1.3)
// ---------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CargoEquipe {
    Membro,
    Admin,
    Dono,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Equipe {
    pub id: String,
    pub nome: String,
    pub criado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MembroEquipe {
    pub equipe_id: String,
    pub usuario_id: String,
    pub cargo: CargoEquipe,
    pub entrou_em: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConviteEstado {
    Pendente,
    Aceito,
    Expirado,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConviteEquipe {
    pub id: String,
    pub equipe_id: String,
    pub codigo: String,
    pub estado: ConviteEstado,
    pub criado_em: DateTime<Utc>,
    pub expira_em: DateTime<Utc>,
}

// ---------------------------------------------------------------------
// Perfil de Rotina (seção 1.3)
// ---------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlocoRotinaTipo {
    Sono,
    TrabalhoFixo,
    Refeicao,
    Deslocamento,
    BloqueioPessoal,
    Outro,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlocoRotinaClassificacao {
    Indisponivel,
    DisponivelProducao,
    TempoLivre,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlocoRotina {
    pub id: String,
    pub usuario_id: String,
    pub tipo: BlocoRotinaTipo,
    /// `"HH:MM"`.
    pub hora_inicio: String,
    pub hora_fim: String,
    /// `"1,2,3,4,5"` (ISO weekday) ou `"diario"`.
    pub dias_semana: String,
    pub classificacao: BlocoRotinaClassificacao,
}

// ---------------------------------------------------------------------
// Calendário externo (seção 1.3 / 6.5)
// ---------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigCalendario {
    pub usuario_id: String,
    pub provider: CalendarioProvider,
    #[serde(skip)]
    pub access_token_encrypted: Vec<u8>,
    #[serde(skip)]
    pub refresh_token_encrypted: Vec<u8>,
    pub calendar_id: String,
    pub conectado_em: DateTime<Utc>,
    #[serde(default)]
    pub sync_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventoExternoCache {
    pub id: String,
    pub provider: CalendarioProvider,
    pub event_id_externo: String,
    #[serde(default)]
    pub tarefa_id: Option<String>,
    pub inicio: DateTime<Utc>,
    pub fim: DateTime<Utc>,
    pub atualizado_em_externo: DateTime<Utc>,
    pub atualizado_em_local: DateTime<Utc>,
}

// ---------------------------------------------------------------------
// Notificação / Dispositivo / ConfigSync (seção 1.3)
// ---------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificacaoCategoria {
    Cofre,
    Agenda,
    Equipes,
    Sync,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notificacao {
    pub id: String,
    pub usuario_id: String,
    pub categoria: NotificacaoCategoria,
    pub titulo: String,
    pub corpo: String,
    pub lida: bool,
    pub criado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DispositivoPapel {
    Primario,
    Espelho,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PushTipo {
    Unifiedpush,
    Fcm,
    Nenhum,
}

impl Default for PushTipo {
    fn default() -> Self {
        PushTipo::Nenhum
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Dispositivo {
    pub id: String,
    pub usuario_id: String,
    pub nome: String,
    pub papel: DispositivoPapel,
    #[serde(default)]
    pub ultima_sincronizacao: Option<DateTime<Utc>>,
    #[serde(default)]
    pub endereco_rede: Option<String>,
    #[serde(default)]
    pub publico_chave: Option<String>,
    #[serde(default)]
    pub push_tipo: PushTipo,
    #[serde(default)]
    pub push_endpoint: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModoSync {
    LocalUnico,
    DiretoLan,
    GoogleDrive,
}

impl Default for ModoSync {
    fn default() -> Self {
        ModoSync::LocalUnico
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigSync {
    pub usuario_id: String,
    #[serde(default)]
    pub modo: ModoSync,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn espaco_roundtrip() {
        assert_eq!("pessoal".parse::<Espaco>().unwrap(), Espaco::Pessoal);
        assert_eq!(
            "equipe:eq_01".parse::<Espaco>().unwrap(),
            Espaco::Equipe("eq_01".to_string())
        );
        assert!("equipe:".parse::<Espaco>().is_err());
        assert!("qualquer-coisa".parse::<Espaco>().is_err());
        assert_eq!(Espaco::Equipe("eq_01".into()).to_string(), "equipe:eq_01");
    }

    #[test]
    fn espaco_serializa_como_string() {
        let json = serde_json::to_string(&Espaco::Equipe("eq_01".into())).unwrap();
        assert_eq!(json, "\"equipe:eq_01\"");
        let de: Espaco = serde_json::from_str("\"pessoal\"").unwrap();
        assert_eq!(de, Espaco::Pessoal);
    }

    #[test]
    fn tarefa_antiga_sem_atualizado_em_continua_legivel() {
        let src = "---\nid: t1\ntitulo: Antiga\nstatus: pendente\nespaco: pessoal\ncriado_em: 2026-09-01T10:00:00Z\n---\ncorpo\n";
        let doc = crate::frontmatter::parse::<TarefaFrontMatter>(src).unwrap();
        assert!(doc.front_matter.atualizado_em.is_none());

        let mut fm = doc.front_matter;
        fm.atualizado_em = Some(fm.criado_em);
        let serializado = crate::frontmatter::serialize(&fm, "corpo\n").unwrap();
        let de_novo = crate::frontmatter::parse::<TarefaFrontMatter>(&serializado).unwrap();
        assert_eq!(de_novo.front_matter.atualizado_em, Some(fm.criado_em));
    }
}
