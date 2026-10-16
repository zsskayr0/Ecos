-- Preferências de aviso por categoria (caixa interna e push), fila de entrega de push e estado do endpoint do aparelho.
CREATE TABLE notificacao_preferencia (
  usuario_id TEXT NOT NULL REFERENCES usuario (id) ON DELETE CASCADE,
  categoria TEXT NOT NULL CHECK (categoria IN ('cofre', 'agenda', 'equipes', 'sync')),
  caixa INTEGER NOT NULL DEFAULT 1,
  push INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (usuario_id, categoria)
);

-- push_desativado_em: endpoint recusado pelo serviço (inválido/expirado) ou falhando de vez; limpo ao registrar de novo.
ALTER TABLE dispositivo ADD COLUMN push_falhas INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dispositivo ADD COLUMN push_desativado_em TEXT;

CREATE TABLE push_fila (
  id TEXT PRIMARY KEY,
  notificacao_id TEXT NOT NULL REFERENCES notificacao (id) ON DELETE CASCADE,
  dispositivo_id TEXT NOT NULL REFERENCES dispositivo (id) ON DELETE CASCADE,
  estado TEXT NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente', 'enviado', 'falhou', 'cancelado')),
  tentativas INTEGER NOT NULL DEFAULT 0,
  proxima_tentativa_em TEXT NOT NULL,
  expira_em TEXT NOT NULL,
  ultimo_erro TEXT,
  criado_em TEXT NOT NULL
);
CREATE INDEX idx_push_fila_pendente ON push_fila (estado, proxima_tentativa_em);
CREATE INDEX idx_push_fila_dispositivo ON push_fila (dispositivo_id);
