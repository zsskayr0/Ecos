//! Descoberta mDNS (seção 6.1): anuncia esta instância como
//! `_ecos._tcp.local` na rede local. Só o anúncio — o handshake de sync
//! propriamente dito (troca de listas `{caminho, hash, atualizado_em}` e
//! transferência cifrada por dispositivo pareado) ainda não está
//! implementado; ver `routes::sync` pro que já existe (pareamento por
//! código + tabela `dispositivo`).

use crate::config::Config;
use mdns_sd::{ServiceDaemon, ServiceInfo};
use sha2::{Digest, Sha256};

pub fn anunciar(config: &Config) {
    let daemon = match ServiceDaemon::new() {
        Ok(d) => d,
        Err(err) => {
            tracing::warn!(error = %err, "mDNS indisponível — descoberta automática de sync LAN desativada");
            return;
        }
    };

    // Nome de instância estável (derivado do segredo de sessão, nunca do
    // segredo em si) — evita expor qualquer coisa sensível no anúncio.
    let sufixo = hex_curto(&config.session_secret);
    let nome_instancia = format!("ecos-{sufixo}");
    let host_name = format!("{nome_instancia}.local.");
    let propriedades = [("versao", env!("CARGO_PKG_VERSION"))];

    let info = match ServiceInfo::new("_ecos._tcp.local.", &nome_instancia, &host_name, "", config.porta, &propriedades[..]) {
        Ok(info) => info.enable_addr_auto(),
        Err(err) => {
            tracing::warn!(error = %err, "não foi possível montar o registro mDNS");
            return;
        }
    };

    if let Err(err) = daemon.register(info) {
        tracing::warn!(error = %err, "não foi possível registrar _ecos._tcp.local");
        return;
    }

    tracing::info!(instancia = %nome_instancia, porta = config.porta, "anunciando via mDNS (_ecos._tcp.local, seção 6.1)");
    // Mantém o daemon vivo pelo tempo de vida do processo — encerrar o
    // anúncio junto do processo é o comportamento correto aqui.
    Box::leak(Box::new(daemon));
}

fn hex_curto(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().take(4).map(|b| format!("{b:02x}")).collect()
}
