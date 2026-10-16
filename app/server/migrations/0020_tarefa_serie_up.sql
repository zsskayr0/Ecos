-- Ocorrência de série recorrente: espelha o front-matter do .md (o reindex repovoa). A regra mora no arquivo da
-- série; estas colunas só deixam achar as ocorrências de uma série e impedem gerar duas vezes a mesma data.
ALTER TABLE tarefa ADD COLUMN serie_id TEXT;
ALTER TABLE tarefa ADD COLUMN ocorrencia_data TEXT;
CREATE INDEX idx_tarefa_serie ON tarefa (serie_id, ocorrencia_data);
