# Ecos

Sistema pessoal de produtividade **local-first**: Notas e Tarefas vivem como
arquivos `.md` numa pasta sua; o Cofre (financeiro) é opcional, isolado num
banco criptografado; tudo self-hosted via Docker + Cloudflare Tunnel. Ver
[`ecos-arquitetura-tecnica.md`](./ecos-arquitetura-tecnica.md) para a
arquitetura completa (modelo de dados, segurança, sync, API).

## Estrutura

```
ecos/
├── crates/ecos-core/   # tipos + regras de negócio compartilhadas (parsing de
│                         front-matter/wikilink, recorrência, ranking do Feed)
├── apps/
│   ├── server/         # ecos-app (Axum) — API pública, hub de sync
│   ├── vault/          # ecos-vault-db (Axum) — Cofre, rede interna só
│   └── client/         # cliente Tauri + React (front-end completo, ver apps/client/README.md)
├── docker-compose.yml
├── docker-compose.staging.yml
└── docs/README-cofre.md
```

O cliente (`apps/client`, Tauri/React) implementa as 12 telas do front-end
a partir da especificação de marca/design (ver `apps/client/README.md`
para como rodar e as lacunas sinalizadas); consome dados mockados até a
integração real contra as rotas abaixo estar ligada na UI.

## Build & testes

```bash
cargo build --workspace
cargo test --workspace
```

## Rodar localmente (sem Docker)

```bash
# Notas/Tarefas — sem Cofre
ECOS_NOTES_PATH=./data/notes cargo run -p ecos-app

# Cofre, em outro terminal
ECOS_VAULT_DB_PATH=./data/vault/ecos-vault.db cargo run -p ecos-vault-db
```

`ecos-app` sobe em `http://localhost:7023`, `ecos-vault-db` em
`http://localhost:8090`. Primeiro acesso: `POST /api/v1/auth/registrar`.
Para ligar o proxy do Cofre no `ecos-app`, defina
`ECOS_VAULT_ENABLED=true` e `ECOS_VAULT_URL=http://localhost:8090`.

## Rodar via Docker

```bash
cp .env.example .env   # ajuste ECOS_NOTES_PATH e CF_TUNNEL_TOKEN
docker compose up -d                              # só Notas/Tarefas
docker compose --profile vault --profile default up -d   # + Cofre
```

Ativação do Cofre: [`docs/README-cofre.md`](./docs/README-cofre.md).

## Limitações conhecidas desta fundação

Documentadas inline no código (`// TODO` / comentários `RISCO:`), não
escondidas:

- **SQLCipher real** (`apps/vault`, feature `real-sqlcipher`) não compila
  neste ambiente de desenvolvimento Windows — falta um Perl completo pro
  build do OpenSSL vendorizado. O `Dockerfile` de produção (Debian) instala
  `perl`+`build-essential` e ativa a feature; sem ela, o Vault roda sem
  cifra — nunca usar esse modo com dado financeiro real.
- OAuth Google Calendar/Microsoft Graph/Google Drive, push
  UnifiedPush/FCM, biometria WebAuthn e OCR (Tesseract/`leptess`) têm
  contrato de API completo mas lógica `TODO` — dependem de credenciais
  externas ou hardware que não dá pra validar aqui.
- Sync direto LAN: pareamento por código e tabela `dispositivo` são reais;
  anúncio mDNS roda; a transferência de arquivo cifrada entre dispositivos
  pareados ainda não está implementada.
