-- Tipo da equipe: `pessoal` (pessoal/familiar) ou `corporativo`. Hoje só rotula; as regras de cada tipo
-- (permissões, campos do Cofre etc.) vão divergir depois. As equipes que já existem ficam como pessoal/familiar.
ALTER TABLE equipe ADD COLUMN tipo TEXT NOT NULL DEFAULT 'pessoal' CHECK (tipo IN ('pessoal', 'corporativo'));
