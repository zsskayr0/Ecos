-- Categorias que já existiam no Nexus (banco real, 2026-09), trazidas para o Cofre.
-- Idempotente: só insere se ainda não houver categoria com o mesmo nome no espaço pessoal,
-- então não duplica nem mexe nas que a pessoa já criou no Cofre. Ícones em Lucide (PascalCase).
INSERT INTO categoria (id, nome, tipo, icone, cor, padrao, espaco)
SELECT v.id, v.nome, v.tipo, v.icone, v.cor, v.padrao, 'pessoal'
FROM (
  SELECT 'cat_nexus_renda' AS id, 'Renda' AS nome, 'entrada' AS tipo, 'Briefcase' AS icone, '#8fd9ac' AS cor, 1 AS padrao
  UNION ALL SELECT 'cat_nexus_renda_extra', 'Renda extra', 'entrada', 'Wallet', '#8fd9ac', 1
  UNION ALL SELECT 'cat_nexus_transferencia', 'Transferência recebida', 'entrada', 'Landmark', '#b98cf2', 1
  UNION ALL SELECT 'cat_nexus_moradia', 'Moradia', 'saida', 'Home', '#6ec6ff', 1
  UNION ALL SELECT 'cat_nexus_alimentacao', 'Alimentação', 'saida', 'Coffee', '#e4636b', 1
  UNION ALL SELECT 'cat_nexus_transporte', 'Transporte', 'saida', 'Truck', '#f28fb0', 1
  UNION ALL SELECT 'cat_nexus_saude', 'Saúde', 'saida', 'Shield', '#8fd9ac', 1
  UNION ALL SELECT 'cat_nexus_assinaturas', 'Assinaturas', 'saida', 'Repeat', '#b98cf2', 1
  UNION ALL SELECT 'cat_nexus_streaming', 'Streaming', 'saida', 'ArrowLeftRight', '#f28fb0', 0
  UNION ALL SELECT 'cat_nexus_outros', 'Outros', 'ambos', 'MoreHorizontal', '#96969c', 1
) v
WHERE NOT EXISTS (SELECT 1 FROM categoria c WHERE c.nome = v.nome COLLATE NOCASE AND c.espaco = 'pessoal');
