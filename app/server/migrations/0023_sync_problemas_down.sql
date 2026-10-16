ALTER TABLE notificacao DROP COLUMN acao_url;
DROP INDEX idx_sync_problema_usuario;
DROP TABLE sync_problema;
ALTER TABLE config_calendario DROP COLUMN ultimo_resumo;
ALTER TABLE config_calendario DROP COLUMN ultima_tentativa_em;
ALTER TABLE config_calendario DROP COLUMN erros_seguidos;
ALTER TABLE config_calendario DROP COLUMN erro_em;
ALTER TABLE config_calendario DROP COLUMN erro_tipo;
