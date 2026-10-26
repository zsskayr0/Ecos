-- Cor de uma tag no catálogo de um espaço (pessoal ou equipe). Fora do índice derivado: o reindex não a apaga.
-- Sem linha = cor automática (derivada do nome no cliente). Tags de espaços diferentes são catálogos separados.
CREATE TABLE tag_cor (
  espaco TEXT NOT NULL,
  tag TEXT NOT NULL,
  cor TEXT NOT NULL,
  PRIMARY KEY (espaco, tag)
);
