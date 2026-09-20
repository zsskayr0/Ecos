-- Registro de aceites feitos no cadastro (LGPD/conformidade): declaração de
-- idade mínima e, no futuro, Termos e Política. Não guarda data de nascimento,
-- só o fato, a versão da regra aceita e quando. `versao` é a idade mínima
-- vigente (tipo 'idade_minima') ou a versão do documento (tipo 'termos').
CREATE TABLE consentimento (
  usuario_id TEXT NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  versao TEXT NOT NULL,
  aceito_em TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (usuario_id, tipo, versao)
);
