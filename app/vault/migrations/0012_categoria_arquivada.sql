-- Categorias arquivadas somem dos seletores de lançamento, mas continuam valendo para o histórico e na tela de Categorias.
ALTER TABLE categoria ADD COLUMN arquivada INTEGER NOT NULL DEFAULT 0;
