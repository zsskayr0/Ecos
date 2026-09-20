-- Exceções de séries (ocorrência remarcada/editada/cancelada) e linhas extras de recorrência (EXDATE...).
-- Tudo vem dos `.md` (o reindex repovoa); `excecoes_pendentes` diz ao envio ao Google quais séries têm o que enviar.
ALTER TABLE evento ADD COLUMN excecoes TEXT NOT NULL DEFAULT '[]';
ALTER TABLE evento ADD COLUMN recorrencia_extra TEXT NOT NULL DEFAULT '[]';
ALTER TABLE evento ADD COLUMN excecoes_pendentes INTEGER NOT NULL DEFAULT 0;

-- As exceções de série que já existiam no Google eram ignoradas até aqui e o sync incremental não as reenvia:
-- zera o cursor uma vez para o próximo ciclo reler tudo (o que já está igual é pulado pelo etag).
UPDATE config_calendario SET sync_cursor = NULL;
