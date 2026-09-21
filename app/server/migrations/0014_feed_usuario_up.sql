-- Cada pessoa tem o próprio Cofre: o card de transação do Feed precisa saber de quem é.
-- (Notas e Tarefas continuam filtradas pelo espaço/criado_por da origem.) Índice derivado, refeito a cada ciclo.
DELETE FROM feed_item WHERE tipo = 'transacao';
ALTER TABLE feed_item ADD COLUMN usuario_id TEXT;
