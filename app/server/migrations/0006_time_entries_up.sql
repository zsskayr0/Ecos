CREATE TABLE tarefa_time_entry (
  id TEXT PRIMARY KEY,
  tarefa_id TEXT NOT NULL REFERENCES tarefa(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK(tipo IN ('planejado', 'real')),
  inicio_em TEXT NOT NULL,
  fim_em TEXT,
  duracao_min INTEGER NOT NULL CHECK(duracao_min > 0),
  foco TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL
);
CREATE INDEX idx_time_entry_tarefa ON tarefa_time_entry(tarefa_id, inicio_em DESC);
