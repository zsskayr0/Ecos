-- Estado detalhado da conexão com o Google: por que a última sincronização falhou (reautorizar x temporário), há
-- quantas tentativas seguidas, quando foi a última tentativa e o resumo do último ciclo bem-sucedido (JSON).
ALTER TABLE config_calendario ADD COLUMN erro_tipo TEXT CHECK (erro_tipo IN ('reautorizar', 'temporario'));
ALTER TABLE config_calendario ADD COLUMN erro_em TEXT;
ALTER TABLE config_calendario ADD COLUMN erros_seguidos INTEGER NOT NULL DEFAULT 0;
ALTER TABLE config_calendario ADD COLUMN ultima_tentativa_em TEXT;
ALTER TABLE config_calendario ADD COLUMN ultimo_resumo TEXT;

-- Problemas de sincronização por item: um por (pessoa, provedor, tipo, item, operação). Reincidência soma tentativas;
-- 'ignorado' continua registrado (não notifica de novo) e 'resolvido' volta a 'aberto' se o erro reaparecer.
CREATE TABLE sync_problema (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuario (id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  item_tipo TEXT NOT NULL CHECK (item_tipo IN ('evento', 'exclusao')),
  item_id TEXT NOT NULL,
  item_titulo TEXT NOT NULL,
  direcao TEXT NOT NULL CHECK (direcao IN ('envio', 'recebimento')),
  operacao TEXT NOT NULL,
  codigo TEXT NOT NULL,
  http_status INTEGER,
  motivo_google TEXT,
  tentativas INTEGER NOT NULL DEFAULT 1,
  primeira_vez TEXT NOT NULL,
  ultima_vez TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'aberto' CHECK (estado IN ('aberto', 'ignorado', 'resolvido')),
  UNIQUE (usuario_id, provider, item_tipo, item_id, operacao)
);
CREATE INDEX idx_sync_problema_usuario ON sync_problema (usuario_id, estado);

-- Link de ação da notificação (rota interna do app).
ALTER TABLE notificacao ADD COLUMN acao_url TEXT;
