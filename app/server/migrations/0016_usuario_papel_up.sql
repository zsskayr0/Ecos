-- Administração no estilo Jellyfin: o primeiro usuário é administrador e cria as contas das outras pessoas, que
-- entram com uma senha temporária e são obrigadas a trocá-la no primeiro acesso.
ALTER TABLE usuario ADD COLUMN papel TEXT NOT NULL DEFAULT 'usuario' CHECK (papel IN ('admin', 'usuario'));
ALTER TABLE usuario ADD COLUMN deve_trocar_senha INTEGER NOT NULL DEFAULT 0;
UPDATE usuario SET papel = 'admin' WHERE id = (SELECT id FROM usuario ORDER BY criado_em, id LIMIT 1);
