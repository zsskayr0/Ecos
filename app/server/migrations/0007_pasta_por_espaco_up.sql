-- A mesma pasta pode existir em áreas de trabalho diferentes.
ALTER TABLE pasta_cache RENAME TO pasta_cache_antiga;
CREATE TABLE pasta_cache (
  caminho TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('nota', 'tarefa')),
  nome TEXT NOT NULL,
  espaco TEXT NOT NULL,
  contagem_itens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tipo, caminho, espaco)
);
INSERT INTO pasta_cache (caminho, tipo, nome, espaco, contagem_itens)
SELECT caminho, tipo, nome, espaco, contagem_itens FROM pasta_cache_antiga;
DROP TABLE pasta_cache_antiga;
