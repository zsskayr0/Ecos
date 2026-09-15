DROP TABLE IF EXISTS tarefa_tag;
DROP INDEX IF EXISTS idx_tarefa_prioridade;
DROP INDEX IF EXISTS idx_tarefa_pasta_id;
ALTER TABLE tarefa DROP COLUMN prioridade;
ALTER TABLE tarefa DROP COLUMN pasta_id;
