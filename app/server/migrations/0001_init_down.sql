PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS config_sync;
DROP TABLE IF EXISTS dispositivo;
DROP TABLE IF EXISTS notificacao;
DROP TABLE IF EXISTS evento_externo_cache;
DROP TABLE IF EXISTS config_calendario;
DROP TABLE IF EXISTS bloco_rotina;
DROP TABLE IF EXISTS perfil_rotina;
DROP TABLE IF EXISTS convite_equipe;
DROP TABLE IF EXISTS membro_equipe;
DROP TABLE IF EXISTS equipe;
DROP TABLE IF EXISTS tarefa_fts;
DROP TABLE IF EXISTS nota_fts;
DROP TABLE IF EXISTS feed_item;
DROP TABLE IF EXISTS documento_cache;
DROP TABLE IF EXISTS pasta_cache;
DROP TABLE IF EXISTS tarefa;
DROP TABLE IF EXISTS links_nota;
DROP TABLE IF EXISTS nota_tag;
DROP TABLE IF EXISTS nota;
DROP TABLE IF EXISTS sessao;
DROP TABLE IF EXISTS usuario;

PRAGMA foreign_keys = ON;
