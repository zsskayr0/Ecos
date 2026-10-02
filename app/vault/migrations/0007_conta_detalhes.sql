-- Contas com mais detalhe: tipo (corrente, poupança, carteira...), código COMPE do banco (para o logo/identificação)
-- e saldo inicial (o saldo do dia em que a conta entrou no Cofre; os lançamentos somam a partir dele).
ALTER TABLE conta ADD COLUMN tipo TEXT NOT NULL DEFAULT 'corrente';
ALTER TABLE conta ADD COLUMN codigo_banco TEXT;
ALTER TABLE conta ADD COLUMN saldo_inicial_centavos INTEGER NOT NULL DEFAULT 0;
