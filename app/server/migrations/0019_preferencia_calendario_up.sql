-- Preferências de calendário e localização por pessoa (antes só no localStorage de cada aparelho).
-- Sem linha = a pessoa nunca salvou: o servidor responde os padrões e o cliente pode subir os valores locais.
CREATE TABLE preferencia_calendario (
  usuario_id TEXT PRIMARY KEY REFERENCES usuario (id) ON DELETE CASCADE,
  pais TEXT NOT NULL,
  fuso TEXT NOT NULL,
  inicio_dia TEXT NOT NULL,
  mostrar_prazos INTEGER NOT NULL DEFAULT 1,
  atualizado_em TEXT NOT NULL
);
