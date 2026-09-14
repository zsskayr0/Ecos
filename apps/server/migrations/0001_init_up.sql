-- Índice local (`ecos-index.db`) — cache derivado, reconstruível a partir
-- dos `.md` e das APIs externas; nunca é fonte de verdade (seção 1.1).

-- usuario: identidade local da instância, sem conta em nuvem (seção 5.1).
CREATE TABLE usuario (
  id TEXT PRIMARY KEY,
  nome_usuario TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  recovery_key_hash TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sessao: cookie de refresh opaco, guardado hasheado, por dispositivo.
CREATE TABLE sessao (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  dispositivo_id TEXT,
  refresh_token_hash TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  expira_em TEXT NOT NULL,
  revogado_em TEXT
);
CREATE INDEX idx_sessao_usuario ON sessao(usuario_id);

-- nota: espelho do front-matter do .md (seção 1.3).
CREATE TABLE nota (
  id TEXT PRIMARY KEY,
  caminho_arquivo TEXT NOT NULL UNIQUE,
  titulo TEXT NOT NULL,
  modo TEXT NOT NULL DEFAULT 'texto' CHECK (modo IN ('texto', 'pagina')),
  pasta_id TEXT,
  espaco TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  ultima_revisao_em TEXT,
  hash_conteudo TEXT NOT NULL,
  contagem_acessos_7d INTEGER NOT NULL DEFAULT 0,
  ocr_texto_busca TEXT
);
CREATE INDEX idx_nota_atualizado_em ON nota (atualizado_em);
CREATE INDEX idx_nota_espaco ON nota (espaco);
CREATE INDEX idx_nota_pasta ON nota (pasta_id);

CREATE TABLE nota_tag (
  nota_id TEXT NOT NULL REFERENCES nota (id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (nota_id, tag)
);
CREATE INDEX idx_nota_tag_tag ON nota_tag (tag);

-- links_nota: arestas de wikilink resolvidas no reindex — alimenta o
-- critério Órfã do ranking (seção 4.1).
CREATE TABLE links_nota (
  nota_id_origem TEXT NOT NULL REFERENCES nota (id) ON DELETE CASCADE,
  nota_id_destino TEXT NOT NULL REFERENCES nota (id) ON DELETE CASCADE,
  PRIMARY KEY (nota_id_origem, nota_id_destino)
);
CREATE INDEX idx_links_nota_destino ON links_nota (nota_id_destino);

-- tarefa: espelho do front-matter do .md (seção 1.3), árvore independente da de Nota.
CREATE TABLE tarefa (
  id TEXT PRIMARY KEY,
  caminho_arquivo TEXT NOT NULL UNIQUE,
  titulo TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'concluida')),
  scheduled_at TEXT,
  duration_min INTEGER,
  due_date TEXT,
  espaco TEXT NOT NULL,
  evento_provider TEXT CHECK (evento_provider IN ('google', 'microsoft')),
  evento_event_id TEXT,
  evento_synced_at TEXT,
  criado_em TEXT NOT NULL
);
CREATE INDEX idx_tarefa_scheduled_at ON tarefa (scheduled_at);
CREATE INDEX idx_tarefa_espaco ON tarefa (espaco);

-- pasta_cache / documento_cache: derivadas do reindex, nunca gravadas por
-- sync (seção 1.3 — Pasta não é entidade persistida; Documento é
-- identificado por hash de conteúdo, sem front-matter possível).
CREATE TABLE pasta_cache (
  caminho TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('nota', 'tarefa')),
  nome TEXT NOT NULL,
  espaco TEXT NOT NULL,
  contagem_itens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tipo, caminho)
);

CREATE TABLE documento_cache (
  caminho TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'pdf',
  tamanho_bytes INTEGER NOT NULL,
  hash_conteudo TEXT NOT NULL,
  pasta TEXT,
  espaco TEXT NOT NULL
);

-- feed_item: resultado do job de ranking (seção 4) — é o que `GET /feed` lê,
-- paginado por cursor (seção 11.1/11.7).
CREATE TABLE feed_item (
  id TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('nota', 'tarefa_encaixada', 'transacao')),
  motivo TEXT CHECK (motivo IN ('esquecimento', 'orfa', 'frescor', 'interacao')),
  score_dominante REAL NOT NULL DEFAULT 0,
  dado_bruto TEXT,
  espaco TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  PRIMARY KEY (tipo, id)
);
CREATE INDEX idx_feed_item_espaco_score ON feed_item (espaco, score_dominante DESC);

-- FTS5 (seção 1.4 / 11.8) — busca full-text unificada.
CREATE VIRTUAL TABLE nota_fts USING fts5(id UNINDEXED, titulo, corpo, ocr_texto_busca);
CREATE VIRTUAL TABLE tarefa_fts USING fts5(id UNINDEXED, titulo);

-- equipe / membro / convite (seção 1.3).
CREATE TABLE equipe (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE membro_equipe (
  equipe_id TEXT NOT NULL REFERENCES equipe (id) ON DELETE CASCADE,
  usuario_id TEXT NOT NULL REFERENCES usuario (id) ON DELETE CASCADE,
  cargo TEXT NOT NULL CHECK (cargo IN ('dono', 'admin', 'membro')),
  entrou_em TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (equipe_id, usuario_id)
);
CREATE TABLE convite_equipe (
  id TEXT PRIMARY KEY,
  equipe_id TEXT NOT NULL REFERENCES equipe (id) ON DELETE CASCADE,
  codigo TEXT NOT NULL UNIQUE,
  estado TEXT NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente', 'aceito', 'expirado')),
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  expira_em TEXT NOT NULL
);

-- perfil de rotina (seção 1.3) — alimenta o cálculo de capacidade do dia.
CREATE TABLE perfil_rotina (
  usuario_id TEXT PRIMARY KEY REFERENCES usuario (id) ON DELETE CASCADE
);
CREATE TABLE bloco_rotina (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES perfil_rotina (usuario_id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (
    tipo IN ('sono', 'trabalho_fixo', 'refeicao', 'deslocamento', 'bloqueio_pessoal', 'outro')
  ),
  hora_inicio TEXT NOT NULL,
  hora_fim TEXT NOT NULL,
  dias_semana TEXT NOT NULL,
  classificacao TEXT NOT NULL CHECK (
    classificacao IN ('indisponivel', 'disponivel_producao', 'tempo_livre')
  )
);

-- calendário externo (seção 1.3 / 6.5) — cache local first, nunca lido em
-- tempo real pelo cálculo de capacidade.
CREATE TABLE config_calendario (
  usuario_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  access_token_encrypted BLOB,
  refresh_token_encrypted BLOB,
  calendar_id TEXT,
  conectado_em TEXT NOT NULL DEFAULT (datetime('now')),
  sync_cursor TEXT,
  PRIMARY KEY (usuario_id, provider)
);
CREATE TABLE evento_externo_cache (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  event_id_externo TEXT NOT NULL,
  tarefa_id TEXT REFERENCES tarefa (id) ON DELETE SET NULL,
  inicio TEXT NOT NULL,
  fim TEXT NOT NULL,
  atualizado_em_externo TEXT NOT NULL,
  atualizado_em_local TEXT NOT NULL
);

-- notificação / dispositivo / config de sync (seção 1.3 / 6.6).
CREATE TABLE notificacao (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuario (id) ON DELETE CASCADE,
  categoria TEXT NOT NULL CHECK (categoria IN ('cofre', 'agenda', 'equipes', 'sync')),
  titulo TEXT NOT NULL,
  corpo TEXT NOT NULL,
  lida INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notificacao_usuario_lida ON notificacao (usuario_id, lida);

CREATE TABLE dispositivo (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuario (id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  papel TEXT NOT NULL CHECK (papel IN ('primario', 'espelho')),
  ultima_sincronizacao TEXT,
  endereco_rede TEXT,
  publico_chave TEXT,
  push_tipo TEXT NOT NULL DEFAULT 'nenhum' CHECK (push_tipo IN ('unifiedpush', 'fcm', 'nenhum')),
  push_endpoint TEXT
);

CREATE TABLE config_sync (
  usuario_id TEXT PRIMARY KEY REFERENCES usuario (id) ON DELETE CASCADE,
  modo TEXT NOT NULL DEFAULT 'local_unico' CHECK (modo IN ('local_unico', 'direto_lan', 'google_drive'))
);
