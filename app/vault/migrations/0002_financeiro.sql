ALTER TABLE transacao ADD COLUMN conciliada INTEGER NOT NULL DEFAULT 0 CHECK (conciliada IN (0, 1));
ALTER TABLE transacao ADD COLUMN data_ocorrencia TEXT;
ALTER TABLE transacao_recorrente ADD COLUMN ocorrencias_legadas INTEGER NOT NULL DEFAULT 0;
UPDATE transacao_recorrente SET ocorrencias_legadas = parcelas_geradas;
UPDATE transacao SET data_ocorrencia = data WHERE transacao_recorrente_id IS NOT NULL;
CREATE TABLE ocorrencia_processada (
  recorrencia_id TEXT NOT NULL,
  data_ocorrencia TEXT NOT NULL,
  transacao_id TEXT NOT NULL,
  PRIMARY KEY (recorrencia_id, data_ocorrencia)
);
INSERT OR IGNORE INTO ocorrencia_processada
SELECT transacao_recorrente_id, data_ocorrencia, id FROM transacao
WHERE transacao_recorrente_id IS NOT NULL ORDER BY criado_em, id;
CREATE INDEX idx_transacao_ocorrencia ON transacao(transacao_recorrente_id, data_ocorrencia);
CREATE INDEX idx_transacao_dedup ON transacao(data, tipo, valor_centavos, descricao);
CREATE TABLE pendencia_convertida (pendencia_id TEXT PRIMARY KEY, transacao_id TEXT NOT NULL);
