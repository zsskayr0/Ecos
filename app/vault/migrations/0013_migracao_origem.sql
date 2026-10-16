-- Rastro de dados trazidos de outro sistema (hoje só o Nexus). Cada linha liga o id de origem ao registro criado (ou
-- reaproveitado) no Cofre: é o que torna a migração idempotente (reaplicar não duplica) e o que permite resolver as
-- referências (categoria, conta, recorrência, lançamento) e os anexos de forma íntegra.
-- `tabela`: categorias | beneficiarios | contas | recorrencias | lancamentos | pendencias | anexos.
CREATE TABLE migracao_origem (
  origem     TEXT NOT NULL,
  tabela     TEXT NOT NULL,
  origem_id  TEXT NOT NULL,
  destino_id TEXT NOT NULL,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (origem, tabela, origem_id)
);
CREATE INDEX idx_migracao_destino ON migracao_origem (tabela, destino_id);
