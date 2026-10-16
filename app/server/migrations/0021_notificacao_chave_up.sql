-- Chave de deduplicação: um produtor que roda várias vezes (varredura de prazos) não repete a mesma notificação.
ALTER TABLE notificacao ADD COLUMN chave TEXT;
CREATE UNIQUE INDEX idx_notificacao_chave ON notificacao (usuario_id, chave) WHERE chave IS NOT NULL;
