-- Eventos apagados no Ecos que ainda existem no Google: a exclusão remota fica registrada aqui até ser enviada
-- (o `.md` some na hora e o índice é descartável, então nenhum dos dois pode guardar esse pedido).
CREATE TABLE evento_exclusao_google (
  calendar_id TEXT NOT NULL,
  google_event_id TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  PRIMARY KEY (calendar_id, google_event_id)
);
