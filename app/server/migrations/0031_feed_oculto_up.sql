-- Personalização do Feed: o que cada pessoa não quer ver no Feed. `tipo` = 'item' (ref = id da nota/tarefa),
-- 'pasta' (ref = caminho da pasta, vale também para as subpastas, dentro do `espaco`) ou 'tag' (ref = tag canônica).
-- Só filtra o Feed: o item continua em listas, pastas e busca.
CREATE TABLE feed_oculto (
  usuario_id TEXT NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('item', 'pasta', 'tag')),
  espaco TEXT NOT NULL DEFAULT '',
  ref TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  PRIMARY KEY (usuario_id, tipo, espaco, ref)
);
