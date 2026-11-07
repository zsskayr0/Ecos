DROP TABLE pasta_cache;
CREATE TABLE pasta_cache (
  caminho TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('nota', 'tarefa')),
  nome TEXT NOT NULL,
  espaco TEXT NOT NULL,
  contagem_itens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tipo, caminho, espaco)
);
