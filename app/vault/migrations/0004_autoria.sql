-- Autoria: quem criou cada registro (id do usuário do Ecos). Só é gravada na criação e nunca é editável.
-- Em Cofre de equipe é o que permite saber quem lançou o quê; nas linhas antigas fica nula.
ALTER TABLE categoria ADD COLUMN criado_por TEXT;
ALTER TABLE conta ADD COLUMN criado_por TEXT;
ALTER TABLE beneficiario ADD COLUMN criado_por TEXT;
ALTER TABLE transacao_recorrente ADD COLUMN criado_por TEXT;
ALTER TABLE pendencia_avulsa ADD COLUMN criado_por TEXT;
