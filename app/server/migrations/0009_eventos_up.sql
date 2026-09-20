-- Eventos de calendário e categorias. Tudo aqui é índice derivado dos `.md`
-- em `<espaço>/Eventos/` (o reindex esvazia e repovoa).
CREATE TABLE categoria_evento (
  id TEXT PRIMARY KEY,
  espaco TEXT NOT NULL,
  nome TEXT NOT NULL,
  cor TEXT NOT NULL,
  icone TEXT
);

CREATE TABLE evento (
  id TEXT PRIMARY KEY,
  caminho_arquivo TEXT NOT NULL,
  titulo TEXT NOT NULL,
  inicio TEXT NOT NULL,
  fim TEXT NOT NULL,
  dia_inteiro INTEGER NOT NULL DEFAULT 0,
  fuso TEXT,
  local TEXT,
  categoria_id TEXT,
  visibilidade TEXT NOT NULL DEFAULT 'privado' CHECK(visibilidade IN ('privado', 'google')),
  rrule TEXT,
  espaco TEXT NOT NULL,
  google_calendar_id TEXT,
  google_event_id TEXT,
  google_etag TEXT,
  google_updated TEXT,
  sync_pendente INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  criado_por TEXT
);
CREATE INDEX idx_evento_inicio ON evento(inicio);
CREATE INDEX idx_evento_categoria ON evento(categoria_id);
CREATE INDEX idx_evento_google ON evento(google_event_id);

CREATE TABLE evento_tarefa (
  evento_id TEXT NOT NULL REFERENCES evento(id) ON DELETE CASCADE,
  tarefa_id TEXT NOT NULL,
  PRIMARY KEY (evento_id, tarefa_id)
);
CREATE INDEX idx_evento_tarefa_tarefa ON evento_tarefa(tarefa_id);

CREATE TABLE evento_nota (
  evento_id TEXT NOT NULL REFERENCES evento(id) ON DELETE CASCADE,
  nota_id TEXT NOT NULL,
  PRIMARY KEY (evento_id, nota_id)
);
CREATE INDEX idx_evento_nota_nota ON evento_nota(nota_id);
