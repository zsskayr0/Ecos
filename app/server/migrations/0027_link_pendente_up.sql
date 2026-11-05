-- Wikilinks sem destino (`[[Algo inexistente]]`): espelho reconstruível pelo reindex, sem fonte de verdade própria.
CREATE TABLE link_pendente (
  origem_tipo TEXT NOT NULL CHECK (origem_tipo IN ('nota', 'tarefa')),
  origem_id TEXT NOT NULL,
  titulo_alvo TEXT NOT NULL,
  PRIMARY KEY (origem_tipo, origem_id, titulo_alvo)
);
CREATE INDEX idx_link_pendente_titulo ON link_pendente (titulo_alvo);
