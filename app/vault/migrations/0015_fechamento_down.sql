-- Desfaz só as tabelas da 0015. O `CHECK` de `anexo.tipo` continua aceitando 'recibo_lucros' (desfazer isso exigiria
-- reescrever o esquema dos anexos); um binário antigo só deixa de oferecer o tipo, e os anexos existentes seguem intactos.
DROP TABLE IF EXISTS fechamento_config;
DROP TABLE IF EXISTS fechamento_conferencia;
