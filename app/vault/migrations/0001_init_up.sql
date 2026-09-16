-- Schema do Vault (seção 1.3-A) — copiado literalmente do documento de
-- arquitetura, adaptado do Nexus (ver ecos-vault-nexus-reuse-policy).

CREATE TABLE categoria (
  id            TEXT PRIMARY KEY,
  nome          TEXT NOT NULL,
  tipo          TEXT NOT NULL CHECK (tipo IN ('entrada', 'saida', 'ambos')) DEFAULT 'saida',
  icone         TEXT,
  cor           TEXT NOT NULL DEFAULT '#7DD3FC',
  padrao        INTEGER NOT NULL DEFAULT 0,
  espaco        TEXT NOT NULL,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE conta (
  id            TEXT PRIMARY KEY,
  nome          TEXT NOT NULL,
  banco         TEXT,
  agencia       TEXT,
  numero_conta  TEXT,
  cor           TEXT NOT NULL DEFAULT '#8f8f96',
  espaco        TEXT NOT NULL,
  padrao        INTEGER NOT NULL DEFAULT 0,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE beneficiario (
  id          TEXT PRIMARY KEY,
  nome        TEXT NOT NULL,
  documento   TEXT,
  observacoes TEXT,
  criado_em   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE transacao_recorrente (
  id                      TEXT PRIMARY KEY,
  tipo                    TEXT NOT NULL CHECK (tipo IN ('entrada', 'saida')),
  descricao               TEXT NOT NULL,
  valor_centavos          INTEGER NOT NULL,
  categoria_id            TEXT REFERENCES categoria (id),
  conta_id                TEXT REFERENCES conta (id),
  beneficiario_id         TEXT REFERENCES beneficiario (id),
  forma_pagamento         TEXT CHECK (
                            forma_pagamento IN ('pix', 'pix_automatico', 'ted', 'cartao', 'dinheiro', 'boleto', 'outro')
                          ),
  tipo_recorrencia        TEXT NOT NULL CHECK (tipo_recorrencia IN ('fixa', 'parcelada')),
  frequencia              TEXT NOT NULL DEFAULT 'mensal' CHECK (frequencia IN ('semanal', 'mensal', 'anual')),
  intervalo               INTEGER NOT NULL DEFAULT 1,
  dia_vencimento          INTEGER,
  data_inicio             TEXT NOT NULL,
  data_fim                TEXT,
  total_parcelas          INTEGER,
  parcelas_geradas        INTEGER NOT NULL DEFAULT 0,
  observacoes             TEXT,
  espaco                  TEXT NOT NULL,
  ativa                   INTEGER NOT NULL DEFAULT 1,
  criado_em               TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE recorrencia_exclusao (
  transacao_recorrente_id TEXT NOT NULL REFERENCES transacao_recorrente (id) ON DELETE CASCADE,
  data_ocorrencia         TEXT NOT NULL,
  criado_em               TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (transacao_recorrente_id, data_ocorrencia)
);

CREATE TABLE transacao (
  id                      TEXT PRIMARY KEY,
  tipo                    TEXT NOT NULL CHECK (tipo IN ('entrada', 'saida')),
  valor_centavos          INTEGER NOT NULL,
  moeda                   TEXT NOT NULL DEFAULT 'BRL',
  data                    TEXT NOT NULL,
  descricao               TEXT NOT NULL,
  categoria_id            TEXT REFERENCES categoria (id),
  conta_id                TEXT REFERENCES conta (id),
  beneficiario_id         TEXT REFERENCES beneficiario (id),
  forma_pagamento         TEXT CHECK (
                            forma_pagamento IN ('pix', 'pix_automatico', 'ted', 'cartao', 'dinheiro', 'boleto', 'outro')
                          ),
  status                  TEXT NOT NULL DEFAULT 'efetivada' CHECK (status IN ('efetivada', 'pendente')),
  observacoes             TEXT,
  origem                  TEXT NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'captura_camera', 'recorrencia_gerada')),
  ocr_texto_bruto         TEXT,
  ocr_confianca           REAL,
  transacao_recorrente_id TEXT REFERENCES transacao_recorrente (id),
  espaco                  TEXT NOT NULL,
  criado_por              TEXT NOT NULL,
  criado_em               TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Anexo (comprovante) — BLOB dentro do próprio SQLCipher, nunca arquivo
-- solto em disco (seção 1.3).
CREATE TABLE anexo (
  id              TEXT PRIMARY KEY,
  transacao_id    TEXT NOT NULL REFERENCES transacao (id) ON DELETE CASCADE,
  nome_arquivo    TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  tamanho_bytes   INTEGER NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  conteudo        BLOB NOT NULL,
  criado_em       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE pendencia_avulsa (
  id                      TEXT PRIMARY KEY,
  tipo                    TEXT NOT NULL CHECK (tipo IN ('entrada', 'saida')),
  descricao               TEXT NOT NULL,
  valor_centavos          INTEGER NOT NULL,
  categoria_id            TEXT REFERENCES categoria (id),
  beneficiario_id         TEXT REFERENCES beneficiario (id),
  transacao_recorrente_id TEXT REFERENCES transacao_recorrente (id),
  observacoes             TEXT,
  espaco                  TEXT NOT NULL,
  criado_em               TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Índices (seção 1.4).
CREATE INDEX idx_transacao_data ON transacao (data);
CREATE INDEX idx_transacao_categoria ON transacao (categoria_id);
CREATE INDEX idx_transacao_tipo ON transacao (tipo);
CREATE INDEX idx_transacao_status ON transacao (status);
CREATE INDEX idx_transacao_conta ON transacao (conta_id);
CREATE INDEX idx_anexo_transacao ON anexo (transacao_id);
CREATE INDEX idx_recorrente_ativa ON transacao_recorrente (ativa, dia_vencimento);
