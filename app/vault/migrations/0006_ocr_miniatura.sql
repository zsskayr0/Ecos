-- Miniatura (JPEG pequeno gerado no servidor) e texto lido do comprovante, para a lista e a busca.
-- O texto do OCR só existe aqui, dentro do arquivo cifrado do Cofre; nunca vai para o índice local.
ALTER TABLE anexo ADD COLUMN miniatura BLOB;
ALTER TABLE anexo ADD COLUMN ocr_texto TEXT;
ALTER TABLE comprovante_rascunho ADD COLUMN miniatura BLOB;
-- processando | pronto | sem_texto | indisponivel | falhou
ALTER TABLE comprovante_rascunho ADD COLUMN ocr_status TEXT NOT NULL DEFAULT 'processando';
-- Quando a leitura começou (permite declarar 'falhou' se travar e reprocessar sem mexer em criado_em).
ALTER TABLE comprovante_rascunho ADD COLUMN ocr_iniciado_em TEXT;
