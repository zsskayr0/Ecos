-- User feedback: "no feed, deve ter a foto de perfil e o nome do dono
-- daquele item" — Nota/Tarefa never tracked who created them (only
-- Transacao, in the Vault, has `criado_por`). For `espaco: pessoal` it's
-- always the sole local user, but `espaco: equipe:*` can be any member,
-- so it has to be real per-item data, not inferred client-side.
ALTER TABLE nota ADD COLUMN criado_por TEXT REFERENCES usuario (id);
ALTER TABLE tarefa ADD COLUMN criado_por TEXT REFERENCES usuario (id);
