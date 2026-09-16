# ecos-app — build multi-stage (seção 6 do plano de execução / seção 2 da
# arquitetura). Binário estático, sem runtime externo pra instalar na
# imagem final (seção 10.3).
#
# Uma porta só em produção (modelo Jellyfin/Immich): este estágio também
# builda o client (Vite) e o `ecos-app` serve a `dist/` resultante junto da
# API (ver ECOS_STATIC_DIR em main.rs) — sem container de front separado.

FROM node:20-slim AS build-client
WORKDIR /build/app/client
COPY app/client/package.json app/client/package-lock.json ./
RUN npm ci
COPY app/client ./
RUN npm run build

FROM rust:1-slim-bookworm AS build
WORKDIR /build

# Cache de dependências: copia só os manifests primeiro.
COPY Cargo.toml Cargo.lock ./
COPY crates/ecos-core/Cargo.toml crates/ecos-core/Cargo.toml
COPY app/server/Cargo.toml app/server/Cargo.toml
COPY app/vault/Cargo.toml app/vault/Cargo.toml

COPY crates/ecos-core crates/ecos-core
COPY app/server app/server
COPY app/vault app/vault

RUN cargo build --release -p ecos-app

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Container não-root (seção 5.4) — usuário dedicado, sem privilégio.
RUN groupadd --gid 10001 ecos && useradd --uid 10001 --gid ecos --no-create-home --shell /usr/sbin/nologin ecos

COPY --from=build /build/target/release/ecos-app /usr/local/bin/ecos-app
COPY --from=build-client /build/app/client/dist /app/static

RUN mkdir -p /data/notes /data/index /data/backups && chown -R ecos:ecos /data /app/static
USER ecos

ENV ECOS_NOTES_PATH=/data/notes \
    ECOS_INDEX_DB_PATH=/data/index/ecos-index.db \
    ECOS_STATIC_DIR=/app/static \
    ECOS_PORT=7023

EXPOSE 7023
ENTRYPOINT ["/usr/local/bin/ecos-app"]
