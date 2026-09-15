-- Tarefa ganha os campos que faltavam pra deixar de ser "muito simples"
-- (feedback direto do usuário): prioridade (que também alimenta o boost do
-- Feed, seção 4/ranking.rs) e tags (mesmo padrão de nota_tag). Subtarefas e
-- descrição continuam só no front-matter/corpo do .md — não precisam de
-- coluna própria porque nunca são filtradas/ordenadas pelo índice.

ALTER TABLE tarefa ADD COLUMN prioridade TEXT NOT NULL DEFAULT 'media' CHECK (prioridade IN ('baixa', 'media', 'alta'));
CREATE INDEX idx_tarefa_prioridade ON tarefa (prioridade);

-- Bug pré-existente descoberto testando "Tarefas devem ter pastas também":
-- `nota` sempre teve `pasta_id`, mas `tarefa` nunca teve — `pastas.rs`
-- (`GET /pastas?tipo=tarefa`) já assumia essa coluna e sempre falhava (erro
-- silencioso, nunca exercitado porque nenhuma tela de Tarefa chamava esse
-- endpoint até agora). Corrigido aqui em vez de só na feature nova, já que
-- é o mesmo dado (`pasta_relativa`, já calculado no reindex) faltando gravar.
ALTER TABLE tarefa ADD COLUMN pasta_id TEXT;
CREATE INDEX idx_tarefa_pasta_id ON tarefa (pasta_id);

CREATE TABLE tarefa_tag (
  tarefa_id TEXT NOT NULL REFERENCES tarefa (id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (tarefa_id, tag)
);
CREATE INDEX idx_tarefa_tag_tag ON tarefa_tag (tag);
