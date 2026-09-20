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
    /// Tempo alocado no calendário (`planejado`) e tempo trabalhado (`real`). Mora no `.md` porque o índice SQLite é
    /// descartável — reconstruído a cada alteração — e um bloco guardado só nele sumiria na edição seguinte.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tempo: Vec<TempoRegistrado>,
    /// Quando a Tarefa foi concluída. Só existe com `status: concluida`; reabrir apaga. Ausente em concluídas antigas — o índice cai pro `atualizado_em`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub concluida_em: Option<DateTime<Utc>>,
    /// See `NotaFrontMatter::criado_por` — same rationale, same migration.
    #[serde(default)]
    pub criado_por: Option<String>,
}

/// Que tipo de tempo um registro guarda: `Planejado` é tempo ALOCADO num dia/horário do calendário (um bloco, que não
/// altera a data da Tarefa); `Real` é tempo efetivamente trabalhado.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TipoTempo {
    Planejado,
    Real,
}

impl TipoTempo {
    pub fn como_str(self) -> &'static str {
        match self {
            TipoTempo::Planejado => "planejado",
            TipoTempo::Real => "real",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TempoRegistrado {
    pub id: String,
    pub tipo: TipoTempo,
    pub inicio_em: DateTime<Utc>,
    pub duracao_min: i64,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub foco: String,
    pub criado_em: DateTime<Utc>,
}

impl TarefaFrontMatter {
    /// Muda o status mantendo `concluida_em` coerente: concluir grava o instante (sem sobrescrever se já estava concluída),
    /// reabrir apaga. Todo caminho que altera `status` deve passar por aqui.
    pub fn definir_status(&mut self, novo: TarefaStatus, agora: DateTime<Utc>) {
        match novo {
            TarefaStatus::Concluida => {
                if self.status != TarefaStatus::Concluida || self.concluida_em.is_none() {
                    self.concluida_em = Some(agora);
                }
            }
            TarefaStatus::Pendente => self.concluida_em = None,
        }
        self.status = novo;
        self.atualizado_em = Some(agora);
    }
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
    pub concluida_em: Option<DateTime<Utc>>,
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

// ---------------------------------------------------------------------
// Evento de calendário (Ecos <-> Google Calendar)
// ---------------------------------------------------------------------

/// `Privado` nunca sai do Ecos; `Google` é sincronizado com o calendário externo.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventoVisibilidade {
    #[default]
    Privado,
    Google,
}

impl EventoVisibilidade {
    pub fn como_str(self) -> &'static str {
        match self {
            EventoVisibilidade::Privado => "privado",
            EventoVisibilidade::Google => "google",
        }
    }
}

/// Vínculo com o evento do Google. Vazio enquanto o evento só existe no Ecos.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct GoogleRef {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calendar_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub etag: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated: Option<DateTime<Utc>>,
}

impl GoogleRef {
    pub fn esta_vazio(&self) -> bool {
        self.calendar_id.is_none() && self.event_id.is_none() && self.etag.is_none() && self.updated.is_none()
    }
}

/// Front-matter do evento (`<espaço>/Eventos/*.md`); o corpo do `.md` é a descrição.
/// Vive no arquivo (e não só no índice SQLite) porque o índice é descartável.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventoFrontMatter {
    pub id: String,
    pub titulo: String,
    pub inicio: DateTime<Utc>,
    pub fim: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub dia_inteiro: bool,
    /// Fuso IANA de exibição (ex. `America/Sao_Paulo`); `inicio`/`fim` são sempre UTC.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fuso: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub categoria_id: Option<String>,
    /// Cor própria do evento (`#RRGGBB`), só do Ecos: vale sobre a cor da categoria. Nunca vai ao Google.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cor: Option<String>,
    #[serde(default)]
    pub visibilidade: EventoVisibilidade,
    /// RRULE (RFC 5545) da série; a expansão de ocorrências é feita na leitura. Séries vêm do Google e lá são
    /// gerenciadas: o Ecos só muda ou cancela uma ocorrência (`excecoes`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rrule: Option<String>,
    /// Outras linhas de `recurrence` do Google (EXDATE, RDATE, EXRULE): guardadas para expandir certo.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recorrencia_extra: Vec<String>,
    /// Ocorrências da série que diferem do padrão (remarcadas, editadas ou canceladas).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub excecoes: Vec<Excecao>,
    /// Vínculos só do Ecos (nunca vão ao Google).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tarefas: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub notas: Vec<String>,
    #[serde(default, skip_serializing_if = "GoogleRef::esta_vazio")]
    pub google: GoogleRef,
    /// Mudança local ainda não enviada ao Google.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub sync_pendente: bool,
    pub espaco: Espaco,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub criado_por: Option<String>,
}

/// Uma ocorrência de série que difere do padrão. A chave é o início ORIGINAL da ocorrência (o `originalStartTime` do
/// Google); só os campos que mudaram são guardados (`None` = herda da série). No Google é o "evento-instância".
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Excecao {
    pub original: DateTime<Utc>,
    /// Ocorrência cancelada: some da série.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub cancelada: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub titulo: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inicio: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fim: Option<DateTime<Utc>>,
    /// `Some("")` = local apagado só nesta ocorrência.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub descricao: Option<String>,
    #[serde(default, skip_serializing_if = "GoogleRef::esta_vazio")]
    pub google: GoogleRef,
    /// Mudança local ainda não enviada ao Google.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub sync_pendente: bool,
    pub atualizado_em: DateTime<Utc>,
}

impl EventoFrontMatter {
    pub fn duracao_min(&self) -> i64 {
        (self.fim - self.inicio).num_minutes()
    }
}

/// Categoria de evento (nome, cor, ícone) — por espaço, em `<espaço>/Eventos/_categorias.yaml`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CategoriaEvento {
    pub id: String,
    pub nome: String,
    /// `#RRGGBB`.
    pub cor: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icone: Option<String>,
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

    fn tarefa_pendente() -> TarefaFrontMatter {
        let src = "---\nid: t1\ntitulo: X\nstatus: pendente\nespaco: pessoal\ncriado_em: 2026-09-01T10:00:00Z\n---\n";
        crate::frontmatter::parse::<TarefaFrontMatter>(src).unwrap().front_matter
    }

    #[test]
    fn tempo_alocado_vai_e_volta_pelo_front_matter_e_tarefa_sem_tempo_nao_grava_o_campo() {
        let mut fm = tarefa_pendente();
        assert!(fm.tempo.is_empty());
        assert!(!crate::frontmatter::serialize(&fm, "").unwrap().contains("tempo"));
        let inicio: DateTime<Utc> = "2026-09-22T13:00:00Z".parse().unwrap();
        fm.tempo.push(TempoRegistrado { id: "b1".into(), tipo: TipoTempo::Planejado, inicio_em: inicio, duracao_min: 45, foco: String::new(), criado_em: inicio });
        let texto = crate::frontmatter::serialize(&fm, "").unwrap();
        assert!(texto.contains("planejado"));
        let de_volta = crate::frontmatter::parse::<TarefaFrontMatter>(&texto).unwrap().front_matter;
        assert_eq!(de_volta.tempo, fm.tempo);
        // A data da Tarefa não é tocada por ter tempo alocado.
        assert_eq!(de_volta.scheduled_at, fm.scheduled_at);
        assert_eq!(de_volta.due_date, fm.due_date);
    }

    #[test]
    fn concluir_grava_a_data_reabrir_apaga_e_concluir_de_novo_nao_a_sobrescreve() {
        let t1: DateTime<Utc> = "2026-09-19T10:00:00Z".parse().unwrap();
        let t2: DateTime<Utc> = "2026-09-20T11:00:00Z".parse().unwrap();
        let mut fm = tarefa_pendente();
        assert!(fm.concluida_em.is_none());

        fm.definir_status(TarefaStatus::Concluida, t1);
        assert_eq!(fm.concluida_em, Some(t1));
        assert_eq!(fm.atualizado_em, Some(t1));

        fm.definir_status(TarefaStatus::Concluida, t2); // já concluída: mantém a data original
        assert_eq!(fm.concluida_em, Some(t1));

        fm.definir_status(TarefaStatus::Pendente, t2);
        assert!(fm.concluida_em.is_none());
        fm.definir_status(TarefaStatus::Concluida, t2);
        assert_eq!(fm.concluida_em, Some(t2));
    }

    #[test]
    fn concluida_em_vai_e_volta_pelo_front_matter_e_pendente_nao_grava_o_campo() {
        let mut fm = tarefa_pendente();
        assert!(!crate::frontmatter::serialize(&fm, "").unwrap().contains("concluida_em"));
        let t: DateTime<Utc> = "2026-09-19T10:00:00Z".parse().unwrap();
        fm.definir_status(TarefaStatus::Concluida, t);
        let texto = crate::frontmatter::serialize(&fm, "").unwrap();
        assert!(texto.contains("concluida_em"));
        assert_eq!(crate::frontmatter::parse::<TarefaFrontMatter>(&texto).unwrap().front_matter.concluida_em, Some(t));
    }
}

#[cfg(test)]
mod testes_evento {
    use super::*;

    fn evento() -> EventoFrontMatter {
        let t: DateTime<Utc> = "2026-09-21T13:00:00Z".parse().unwrap();
        EventoFrontMatter {
            id: "e1".into(),
            titulo: "Reunião".into(),
            inicio: t,
            fim: t + chrono::Duration::minutes(45),
            dia_inteiro: false,
            fuso: None,
            local: None,
            categoria_id: Some("c1".into()),
            cor: None,
            visibilidade: EventoVisibilidade::Privado,
            rrule: None,
            recorrencia_extra: vec![],
            excecoes: vec![],
            tarefas: vec!["t1".into()],
            notas: vec![],
            google: GoogleRef::default(),
            sync_pendente: false,
            espaco: Espaco::Pessoal,
            criado_em: t,
            atualizado_em: t,
            criado_por: None,
        }
    }

    #[test]
    fn evento_faz_roundtrip_e_omite_campos_vazios() {
        let fm = evento();
        let texto = crate::frontmatter::serialize(&fm, "pauta
").unwrap();
        assert!(!texto.contains("google"));
        assert!(!texto.contains("sync_pendente"));
        assert!(!texto.contains("notas"));
        let doc = crate::frontmatter::parse::<EventoFrontMatter>(&texto).unwrap();
        assert_eq!(doc.front_matter.tarefas, vec!["t1".to_string()]);
        assert_eq!(doc.front_matter.duracao_min(), 45);
        assert_eq!(doc.front_matter.visibilidade, EventoVisibilidade::Privado);
        assert_eq!(doc.body, "pauta
");
    }

    #[test]
    fn evento_minimo_aplica_defaults() {
        let src = "---
id: e2
titulo: X
inicio: 2026-09-21T13:00:00Z
fim: 2026-09-21T14:00:00Z
espaco: pessoal
criado_em: 2026-09-21T10:00:00Z
atualizado_em: 2026-09-21T10:00:00Z
---
";
        let fm = crate::frontmatter::parse::<EventoFrontMatter>(src).unwrap().front_matter;
        assert_eq!(fm.visibilidade, EventoVisibilidade::Privado);
        assert!(fm.google.esta_vazio() && fm.tarefas.is_empty() && !fm.dia_inteiro);
    }
}
