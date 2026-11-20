-- Pastas trancadas (substitui a "pasta secreta única"): qualquer pasta do espaço pessoal pode ser trancada com a senha-mestra
-- (`seguro_config`) ou com uma senha própria; as pastas-filhas herdam (um só nível de tranca, sem aninhar).
CREATE TABLE pasta_trancada (
  usuario_id TEXT NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  -- Caminho da pasta relativo ao espaço pessoal (o mesmo formato de `nota.pasta_id`).
  pasta TEXT NOT NULL,
  -- NULL = usa a senha-mestra; senão, o Argon2id da senha própria desta pasta.
  senha_hash TEXT,
  -- Tempo de inatividade da senha própria (NULL = padrão). Pastas da mestra usam o tempo da mestra.
  minutos INTEGER CHECK (minutos IS NULL OR minutos BETWEEN 1 AND 1440),
  criado_em TEXT NOT NULL,
  PRIMARY KEY (usuario_id, pasta)
);

-- Quem está destrancado agora: `grupo` é 'mestra' ou o caminho da pasta de senha própria; `ate` em segundos (epoch).
-- Está no banco (e não em memória) para o filtro de visibilidade do índice poder consultá-lo direto em SQL.
CREATE TABLE pasta_aberta (
  usuario_id TEXT NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  grupo TEXT NOT NULL,
  ate INTEGER NOT NULL,
  PRIMARY KEY (usuario_id, grupo)
);

-- Se tarefas de pastas trancadas aparecem (mascaradas) na Agenda e no Hoje enquanto trancadas.
CREATE TABLE seguro_preferencia (
  usuario_id TEXT PRIMARY KEY REFERENCES usuario(id) ON DELETE CASCADE,
  mostrar_tarefas INTEGER NOT NULL DEFAULT 0
);
