//! Integração com o Google Calendar: cliente HTTP (`google`), cifra dos tokens (`crypto`) e sincronização
//! (`sync`). As rotas HTTP ficam em `routes::calendario`; o job periódico em `jobs::calendario`.

pub mod crypto;
pub mod google;
pub mod sync;

#[cfg(test)]
mod testes;
