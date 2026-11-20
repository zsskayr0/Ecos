-- Pasta Segura: senha própria (Argon2id) e tempo de auto-bloqueio por pessoa. O conteúdo (diário, notas e tarefas
-- secretas) NÃO fica no índice: são arquivos em `<espaço pessoal>/.ecos_app/Seguro/`, fora de busca, feed e métricas comuns.
CREATE TABLE seguro_config (
  usuario_id TEXT PRIMARY KEY REFERENCES usuario(id) ON DELETE CASCADE,
  senha_hash TEXT NOT NULL,
  minutos INTEGER NOT NULL DEFAULT 5 CHECK (minutos BETWEEN 1 AND 1440),
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
