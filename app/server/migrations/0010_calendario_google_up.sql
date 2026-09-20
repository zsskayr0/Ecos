-- Sincronização com o Google Calendar: estado da conexão e handshake OAuth em andamento.
-- `sync_cursor` (já existente) guarda o `syncToken` incremental do Google.
ALTER TABLE config_calendario ADD COLUMN email TEXT;
ALTER TABLE config_calendario ADD COLUMN fuso TEXT;
ALTER TABLE config_calendario ADD COLUMN access_expira_em TEXT;
ALTER TABLE config_calendario ADD COLUMN ultima_sync_em TEXT;
ALTER TABLE config_calendario ADD COLUMN ultimo_erro TEXT;
ALTER TABLE config_calendario ADD COLUMN precisa_reconectar INTEGER NOT NULL DEFAULT 0;

-- Uma linha por autorização iniciada e ainda não concluída. `state` é de uso único e expira em minutos;
-- o callback do Google chega sem cookie de sessão, então é ele que identifica o usuário.
CREATE TABLE oauth_pendente (
  state TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuario (id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  criado_em TEXT NOT NULL
);
