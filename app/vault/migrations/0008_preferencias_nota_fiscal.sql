-- Preferências de cada pessoa dentro deste Cofre (que, numa equipe, é compartilhado): conta padrão, ordem das
-- contas e das categorias. Ficam aqui, e não no aparelho, para acompanhar a pessoa em qualquer dispositivo.
-- `usuario_id` é quem age (autor), não o dono do Cofre: duas pessoas da mesma equipe têm preferências diferentes.
CREATE TABLE preferencia (
  usuario_id    TEXT NOT NULL,
  chave         TEXT NOT NULL,
  valor         TEXT NOT NULL,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (usuario_id, chave)
);

-- Anexo pode ser comprovante de pagamento ou nota fiscal. Os dois seguem o mesmo caminho (leitura, miniatura, busca).
ALTER TABLE anexo ADD COLUMN tipo TEXT NOT NULL DEFAULT 'comprovante' CHECK (tipo IN ('comprovante', 'nota_fiscal'));
ALTER TABLE comprovante_rascunho ADD COLUMN tipo TEXT NOT NULL DEFAULT 'comprovante' CHECK (tipo IN ('comprovante', 'nota_fiscal'));
