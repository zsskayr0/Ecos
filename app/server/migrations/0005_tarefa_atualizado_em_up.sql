-- Data da última edição da Tarefa (criação, PATCH ou mudança de status) — o cliente mostra
-- "há 3 horas" / "15/09 - 12:46" como num feed. Nullable: tarefas antigas ainda não têm
-- o campo no front-matter; o reindex cai pro mtime do arquivo até a próxima edição.
ALTER TABLE tarefa ADD COLUMN atualizado_em TEXT;
