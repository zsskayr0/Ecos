ALTER TABLE pasta_cache RENAME TO pasta_cache_nova;
CREATE TABLE pasta_cache (
  caminho TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('nota', 'tarefa')),
  nome TEXT NOT NULL,
  espaco TEXT NOT NULL,
  contagem_itens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tipo, caminho)
);
INSERT OR REPLACE INTO pasta_cache (caminho, tipo, nome, espaco, contagem_itens)
SELECT caminho, tipo, nome, espaco, contagem_itens FROM pasta_cache_nova;
DROP TABLE pasta_cache_nova;
