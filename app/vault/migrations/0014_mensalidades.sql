-- Mensalidades: contrato com data-base e histórico de reajustes em cima de uma recorrência de entrada.
-- Só cria tabelas novas; nenhuma tabela existente é alterada e nada é preenchido aqui.
-- Sem `ON DELETE CASCADE`: o Cofre não liga `foreign_keys`, a limpeza é feita por `recorrencias::excluir`.

-- Contrato de mensalidade em cima de uma recorrência de entrada.
CREATE TABLE mensalidade (
  recorrencia_id       TEXT PRIMARY KEY,   -- transacao_recorrente.id
  data_base            TEXT NOT NULL,      -- entrada do residente; o aniversário nunca anda
  ciclos_desde         TEXT NOT NULL,      -- ciclos anteriores a esta data não são cobrados do sistema
  percentual_minimo_bp INTEGER NOT NULL DEFAULT 1000,  -- 10,00%
  aviso_dias           INTEGER NOT NULL DEFAULT 30,
  criado_por           TEXT,
  criado_em            TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Um registro por ciclo anual: é o histórico de valores e a prova de que o ciclo foi tratado.
CREATE TABLE mensalidade_reajuste (
  id                      TEXT PRIMARY KEY,
  recorrencia_id          TEXT NOT NULL,
  ciclo                   TEXT NOT NULL,   -- aniversário a que se refere (ex.: 2026-11-20)
  valor_anterior_centavos INTEGER NOT NULL,
  valor_novo_centavos     INTEGER NOT NULL,
  regra                   TEXT NOT NULL CHECK (regra IN ('minimo', 'igpm', 'negociado', 'mantido')),
  igpm_bp                 INTEGER,         -- IGP-M acumulado digitado, em centésimos de %
  aviso_em                TEXT,            -- quando o responsável foi avisado
  vigente_desde           TEXT,            -- primeira data com o valor novo; nulo = só avisado
  motivo                  TEXT,            -- obrigatório em 'negociado' e 'mantido' (validado na rota)
  criado_por              TEXT,
  criado_em               TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (recorrencia_id, ciclo)
);
CREATE INDEX idx_reajuste_vigencia ON mensalidade_reajuste (recorrencia_id, vigente_desde);
