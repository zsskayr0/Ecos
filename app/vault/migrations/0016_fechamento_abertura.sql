-- Fechamento: saldo de abertura por conta. Diz "no início deste dia a conta tinha tanto" (por exemplo, o saldo que o
-- extrato do banco mostrava) e, dali em diante, o Fechamento soma os lançamentos a partir desse ponto em vez de partir
-- do saldo inicial cadastrado na conta. Vale só para o Fechamento; o saldo da conta no resto do Cofre não muda.
-- Sem `ON DELETE CASCADE`: o Cofre não liga `foreign_keys`; apagar a conta limpa a tabela pelo código.

CREATE TABLE fechamento_abertura (
  conta_id       TEXT NOT NULL,     -- conta.id
  data           TEXT NOT NULL,     -- 'AAAA-MM-DD': o saldo é o de antes dos lançamentos desse dia
  saldo_centavos INTEGER NOT NULL,
  por            TEXT,
  atualizado_em  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (conta_id, data)
);
