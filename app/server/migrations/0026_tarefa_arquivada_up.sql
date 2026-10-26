-- Tarefa ganha o status 'arquivada' (não farei / guardada).
-- O SQLite não altera CHECK: a tabela é refeita. `evento_externo_cache.tarefa_id` (ON DELETE SET NULL) é
-- guardado e restaurado; tarefa_tag e tarefa_time_entry são espelhos do front-matter e a reindexação os repovoa.
CREATE TEMP TABLE _vinculo_evento AS SELECT id, tarefa_id FROM evento_externo_cache WHERE tarefa_id IS NOT NULL;
CREATE TABLE tarefa_nova (
  id TEXT PRIMARY KEY,
  caminho_arquivo TEXT NOT NULL UNIQUE,
  titulo TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'concluida', 'arquivada')),
  scheduled_at TEXT,
  duration_min INTEGER,
  due_date TEXT,
  espaco TEXT NOT NULL,
  evento_provider TEXT CHECK (evento_provider IN ('google', 'microsoft')),
  evento_event_id TEXT,
  evento_synced_at TEXT,
  criado_em TEXT NOT NULL,
  prioridade TEXT NOT NULL DEFAULT 'media' CHECK (prioridade IN ('baixa', 'media', 'alta')),
  pasta_id TEXT,
  criado_por TEXT REFERENCES usuario (id),
  atualizado_em TEXT,
  concluida_em TEXT,
  serie_id TEXT,
  ocorrencia_data TEXT
);
INSERT INTO tarefa_nova (id, caminho_arquivo, titulo, status, scheduled_at, duration_min, due_date, espaco, evento_provider, evento_event_id, evento_synced_at, criado_em, prioridade, pasta_id, criado_por, atualizado_em, concluida_em, serie_id, ocorrencia_data)
SELECT id, caminho_arquivo, titulo, status, scheduled_at, duration_min, due_date, espaco, evento_provider, evento_event_id, evento_synced_at, criado_em, prioridade, pasta_id, criado_por, atualizado_em, concluida_em, serie_id, ocorrencia_data FROM tarefa;
DROP TABLE tarefa;
ALTER TABLE tarefa_nova RENAME TO tarefa;
CREATE INDEX idx_tarefa_scheduled_at ON tarefa (scheduled_at);
CREATE INDEX idx_tarefa_espaco ON tarefa (espaco);
CREATE INDEX idx_tarefa_prioridade ON tarefa (prioridade);
CREATE INDEX idx_tarefa_pasta_id ON tarefa (pasta_id);
CREATE INDEX idx_tarefa_concluida_em ON tarefa (concluida_em);
CREATE INDEX idx_tarefa_serie ON tarefa (serie_id, ocorrencia_data);
UPDATE evento_externo_cache SET tarefa_id = (SELECT v.tarefa_id FROM _vinculo_evento v WHERE v.id = evento_externo_cache.id) WHERE id IN (SELECT id FROM _vinculo_evento) AND EXISTS (SELECT 1 FROM tarefa t WHERE t.id = (SELECT v.tarefa_id FROM _vinculo_evento v WHERE v.id = evento_externo_cache.id));
DROP TABLE _vinculo_evento;
