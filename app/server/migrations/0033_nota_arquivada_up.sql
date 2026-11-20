-- Nota ganha o estado 'arquivada' (espelho do front-matter `arquivada: true`).
ALTER TABLE nota ADD COLUMN arquivada INTEGER NOT NULL DEFAULT 0;
