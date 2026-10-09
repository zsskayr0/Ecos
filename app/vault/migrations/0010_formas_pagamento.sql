-- Formas de pagamento cadastráveis. `transacao.forma_pagamento` e `transacao_recorrente.forma_pagamento` continuam
-- guardando o `codigo` (texto estável), então nenhum lançamento existente muda. As sete de fábrica entram com
-- `padrao = 1`: podem ser renomeadas e desativadas, mas não apagadas (o OCR e a importação dependem dos códigos).
-- O CHECK com a lista fixa dessas duas tabelas é removido pelo gancho Rust desta migração (ver db/mod.rs).
CREATE TABLE forma_pagamento (
  codigo        TEXT PRIMARY KEY,
  nome          TEXT NOT NULL,
  icone         TEXT,
  cor           TEXT,
  padrao        INTEGER NOT NULL DEFAULT 0,
  ativa         INTEGER NOT NULL DEFAULT 1,
  ordem         INTEGER NOT NULL DEFAULT 0,
  criado_por    TEXT,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_forma_pagamento_nome ON forma_pagamento (lower(nome));

INSERT INTO forma_pagamento (codigo, nome, padrao, ordem) VALUES
  ('pix', 'Pix', 1, 1),
  ('pix_automatico', 'Pix Automático', 1, 2),
  ('ted', 'TED', 1, 3),
  ('cartao', 'Cartão', 1, 4),
  ('dinheiro', 'Dinheiro', 1, 5),
  ('boleto', 'Boleto', 1, 6),
  ('outro', 'Outro', 1, 7);
