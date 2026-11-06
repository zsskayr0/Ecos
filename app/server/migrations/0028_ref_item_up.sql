-- Referências de wikilink de cada item de origem (já normalizadas), espelho do corpo repovoado pela reindexação
-- completa e mantido pela incremental: permite refazer os links de entrada de um item que mudou de título ou espaço
-- sem reler o corpo de todos os outros.
CREATE TABLE ref_item (
  origem_tipo TEXT NOT NULL CHECK (origem_tipo IN ('nota', 'tarefa')),
  origem_id TEXT NOT NULL,
  espaco_chave TEXT NOT NULL,
  ref_tipo TEXT NOT NULL DEFAULT '',
  titulo_norm TEXT NOT NULL,
  titulo_bruto TEXT NOT NULL,
  PRIMARY KEY (origem_tipo, origem_id, ref_tipo, titulo_norm)
);
CREATE INDEX idx_ref_item_titulo ON ref_item (espaco_chave, titulo_norm);
