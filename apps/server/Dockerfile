# ecos-app — build multi-stage (seção 6 do plano de execução / seção 2 da
# arquitetura). Binário estático, sem runtime externo pra instalar na
# imagem final (seção 10.3).

FROM rust:1-slim-bookworm AS build
WORKDIR /build

# Cache de dependências: copia só os manifests primeiro.
COPY Cargo.toml Cargo.lock ./
COPY crates/ecos-core/Cargo.toml crates/ecos-core/Cargo.toml
COPY apps/server/Cargo.toml apps/server/Cargo.toml
COPY apps/vault/Cargo.toml apps/vault/Cargo.toml

COPY crates/ecos-core crates/ecos-core
COPY apps/server apps/server
COPY apps/vault apps/vault

RUN cargo build --release -p ecos-app

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Container não-root (seção 5.4) — usuário dedicado, sem privilégio.
RUN groupadd --gid 10001 ecos && useradd --uid 10001 --gid ecos --no-create-home --shell /usr/sbin/nologin ecos

COPY --from=build /build/target/release/ecos-app /usr/local/bin/ecos-app

RUN mkdir -p /data/notes /data/index /data/backups && chown -R ecos:ecos /data
USER ecos

ENV ECOS_NOTES_PATH=/data/notes \
    ECOS_INDEX_DB_PATH=/data/index/ecos-index.db \
    ECOS_PORT=8080

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/ecos-app"]
