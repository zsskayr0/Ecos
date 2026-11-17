-- Desfaz só a 0014: remove as duas tabelas de mensalidades (o índice vai junto). Nenhuma outra tabela é tocada.
DROP TABLE IF EXISTS mensalidade_reajuste;
DROP TABLE IF EXISTS mensalidade;
