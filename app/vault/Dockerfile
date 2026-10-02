# ecos-vault-db — só sobe com `docker compose --profile vault` (seção 2).
# Diferente do `app/server/Dockerfile`, esta imagem compila com
# `--features real-sqlcipher` (ver `app/vault/Cargo.toml` e `crypto.rs`
# pro porquê): SQLCipher de verdade exige compilar OpenSSL a partir do
# fonte via `perl`+`cc`, o que o Debian completo (ao contrário do Perl
# minimalista do Git for Windows usado em dev) suporta nativamente — por
# isso essa feature só é ligada aqui, na build de produção Linux.

FROM rust:1-slim-bookworm AS build
WORKDIR /build

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential perl pkg-config \
    && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
COPY crates/ecos-core/Cargo.toml crates/ecos-core/Cargo.toml
COPY app/server/Cargo.toml app/server/Cargo.toml
COPY app/vault/Cargo.toml app/vault/Cargo.toml

COPY crates/ecos-core crates/ecos-core
COPY app/server app/server
COPY app/vault app/vault

RUN cargo build --release -p ecos-vault-db --features ecos-vault-db/real-sqlcipher

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tesseract-ocr tesseract-ocr-por poppler-utils \
    && rm -rf /var/lib/apt/lists/*
# tesseract-ocr(-por) e poppler-utils: leitura automática de comprovantes (src/ocr). Rodam como processos filhos,
# sem rede (a rede `internal` não tem saída) e com tempo limite; se faltarem, o Cofre segue só no fluxo manual.

RUN groupadd --gid 10002 ecosvault && useradd --uid 10002 --gid ecosvault --no-create-home --shell /usr/sbin/nologin ecosvault

COPY --from=build /build/target/release/ecos-vault-db /usr/local/bin/ecos-vault-db

RUN mkdir -p /data/vault /data/backups && chown -R ecosvault:ecosvault /data
USER ecosvault

ENV ECOS_VAULT_DB_PATH=/data/vault/ecos-vault.db \
    ECOS_VAULT_META_PATH=/data/vault/ecos-vault.meta.json \
    ECOS_BACKUPS_DIR=/data/backups \
    ECOS_PORT=8090

# Sem EXPOSE de propósito documentado: esta porta só é alcançada pela rede
# Docker `internal` (seção 2), nunca publicada no host.
ENTRYPOINT ["/usr/local/bin/ecos-vault-db"]
