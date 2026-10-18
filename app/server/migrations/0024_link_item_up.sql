-- Wikilinks entre notas e tarefas (nos dois sentidos). `links_nota` segue populada só para nota -> nota.
CREATE TABLE link_item (
  origem_tipo TEXT NOT NULL CHECK (origem_tipo IN ('nota', 'tarefa')),
  origem_id TEXT NOT NULL,
  destino_tipo TEXT NOT NULL CHECK (destino_tipo IN ('nota', 'tarefa')),
  destino_id TEXT NOT NULL,
  PRIMARY KEY (origem_tipo, origem_id, destino_tipo, destino_id)
);
CREATE INDEX idx_link_item_destino ON link_item (destino_tipo, destino_id);
CREATE INDEX idx_link_item_origem ON link_item (origem_tipo, origem_id);
