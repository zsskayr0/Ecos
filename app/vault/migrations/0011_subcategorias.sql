-- Subcategorias: uma categoria pode ter um único nível de filhas (sem árvore). O lançamento continua guardando só o
-- `categoria_id` da folha; o caminho completo ("Funcionários › Salários") é derivado de `pai_id` na hora de mostrar,
-- então renomear ou mover a categoria-mãe nunca exige reescrever lançamentos, recorrências ou pendências.
ALTER TABLE categoria ADD COLUMN pai_id TEXT REFERENCES categoria (id);
CREATE INDEX idx_categoria_pai ON categoria (pai_id);
