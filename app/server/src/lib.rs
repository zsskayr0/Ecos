//! Biblioteca do `ecos-app`: o binário (`main.rs`) só monta a configuração e sobe o servidor. Os módulos
//! ficam aqui para que os testes de integração (`tests/`) usem o roteador real, como um cliente faria.

pub mod admin;
pub mod auth;
pub mod calendario;
pub mod config;
pub mod conta;
pub mod db;
pub mod error;
pub mod eventos_fs;
pub mod espacos;
pub mod jobs;
pub mod middleware;
pub mod routes;
pub mod segredos;
pub mod state;
pub mod zip;
