-- Árvore única (ADR árvore única): uma linha por pasta lógica do espaço, com a contagem de cada tipo.
-- pasta_cache é cache derivado do reindex: recriar vazia é seguro (o boot reindexa).
DROP TABLE pasta_cache;
CREATE TABLE pasta_cache (
  caminho TEXT NOT NULL,
  nome TEXT NOT NULL,
  espaco TEXT NOT NULL,
  contagem_notas INTEGER NOT NULL DEFAULT 0,
  contagem_tarefas INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (caminho, espaco)
);
