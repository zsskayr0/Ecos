//! Job de entrega de push: a cada 30 s processa a fila (`crate::push`). Sem aparelhos com push configurado a
//! consulta volta vazia e o job não faz nada. Erro num ciclo vira log e o próximo ciclo segue.

use std::time::Duration;

use crate::push::{processar_fila, EntregaHttp};
use crate::state::AppState;

pub fn iniciar(state: AppState) {
    tokio::spawn(async move {
        let entrega = EntregaHttp { http: state.http.clone() };
        loop {
            let resumo = processar_fila(&state, &entrega, chrono::Utc::now()).await;
            if resumo.entregues + resumo.reagendados + resumo.falhos + resumo.cancelados > 0 {
                tracing::info!(entregues = resumo.entregues, reagendados = resumo.reagendados, falhos = resumo.falhos, cancelados = resumo.cancelados, desativados = resumo.aparelhos_desativados, "push: ciclo concluído");
            }
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    });
}
