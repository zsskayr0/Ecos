-- Data de conclusão da Tarefa: o instante em que foi marcada como concluída (some ao reabrir).
-- A fonte da verdade é o front-matter do `.md` (`concluida_em`); esta coluna só o reflete no reindex e serve
-- pra consultar/ordenar por conclusão. Nullable: pendentes não têm; concluídas anteriores ao campo caem pro
-- `atualizado_em` no reindex (aproximação, até a próxima mudança de status gravar o valor exato).
ALTER TABLE tarefa ADD COLUMN concluida_em TEXT;
CREATE INDEX idx_tarefa_concluida_em ON tarefa (concluida_em);
