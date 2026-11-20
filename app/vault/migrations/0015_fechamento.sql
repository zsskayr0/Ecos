-- Fechamento contábil: o saldo que o extrato do banco mostra no fim de cada mês (para conferir com o do Cofre) e a
-- configuração do bloco "Lucros do mês" (qual categoria é a distribuição de lucros).
-- Só cria tabelas novas. O `CHECK` de `anexo.tipo` ganha 'recibo_lucros' pelo gancho `ampliar_tipos_de_anexo`
-- (em db/mod.rs), sem recriar a tabela dos anexos (BLOBs). Sem `ON DELETE CASCADE`: o Cofre não liga `foreign_keys`.

CREATE TABLE fechamento_conferencia (
  mes                  TEXT NOT NULL,      -- 'AAAA-MM'
  conta_id             TEXT NOT NULL,      -- conta.id
  saldo_banco_centavos INTEGER NOT NULL,   -- saldo no último dia do mês, segundo o extrato do banco
  por                  TEXT,               -- quem digitou
  atualizado_em        TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (mes, conta_id)
);

CREATE TABLE fechamento_config (
  chave TEXT PRIMARY KEY,                  -- ex.: 'categoria_lucros'
  valor TEXT NOT NULL
);
