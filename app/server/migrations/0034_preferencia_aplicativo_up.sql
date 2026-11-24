-- Preferências do aplicativo por conta (Configurações): um documento JSON por pessoa, igual em todos os aparelhos.
-- Sem linha = a pessoa nunca salvou: o cliente sobe os valores que o aparelho já tinha (migração única).
CREATE TABLE preferencia_aplicativo (
  usuario_id TEXT PRIMARY KEY REFERENCES usuario (id) ON DELETE CASCADE,
  dados TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
