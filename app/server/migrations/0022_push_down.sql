DROP INDEX idx_push_fila_dispositivo;
DROP INDEX idx_push_fila_pendente;
DROP TABLE push_fila;
ALTER TABLE dispositivo DROP COLUMN push_desativado_em;
ALTER TABLE dispositivo DROP COLUMN push_falhas;
DROP TABLE notificacao_preferencia;
