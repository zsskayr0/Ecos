-- Comprovante recebido (compartilhado do celular ou solto na janela) que ainda não virou transação.
-- Fica no mesmo arquivo cifrado do Cofre. Ao confirmar, a transação e o anexo nascem juntos e a linha some daqui.
CREATE TABLE comprovante_rascunho (
  id              TEXT PRIMARY KEY,
  nome_arquivo    TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  tamanho_bytes   INTEGER NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  conteudo        BLOB NOT NULL,
  ocr_texto       TEXT,
  ocr_confianca   REAL,
  sugestao_json   TEXT,
  criado_por      TEXT,
  criado_em       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Detecção de comprovante repetido (mesmo arquivo anexado duas vezes).
CREATE INDEX idx_anexo_checksum ON anexo (checksum_sha256);
CREATE INDEX idx_rascunho_checksum ON comprovante_rascunho (checksum_sha256);
