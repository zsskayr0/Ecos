# Ecos

**Local-first** personal productivity system: Notas and Tarefas live as
`.md` files in a folder of your own; the Cofre (finance) is optional,
isolated in an encrypted database; everything self-hosted via Docker +
a private VPN such as Tailscale. See
[`ecos-arquitetura-tecnica.md`](./ecos-arquitetura-tecnica.md) for the
full architecture (data model, security, sync, API).

## Structure

```
ecos/
├── crates/ecos-core/   # shared types + business rules (front-matter/wikilink
│                         parsing, recurrence, Feed ranking)
├── app/
│   ├── server/         # ecos-app (Axum) — public API, sync hub
│   ├── vault/           # ecos-vault-db (Axum) — Cofre, internal network only
│   └── client/          # Tauri + React client (complete front end, see app/client/README.md)
├── (fora do repo) ../ecos-notes/  # ECOS_NOTES_PATH default — Notas/ e Tarefas/ dentro
├── docker-compose.yml
├── docker-compose.staging.yml
└── docs/README-cofre.md
```

The client (`app/client`, Tauri/React) implements the front end's 12
screens from the brand/design spec (see `app/client/README.md` for how
to run it and the flagged gaps) and talks to the real backend end to end
— no mocked data outside its Onboarding flow.

## Build & tests

```bash
cargo build --workspace
cargo test --workspace
```

## Run locally (without Docker)

```bash
# Notas/Tarefas — no Cofre
ECOS_NOTES_PATH=./data/notes cargo run -p ecos-app

# Cofre, in another terminal
ECOS_VAULT_DB_PATH=./data/vault/ecos-vault.db cargo run -p ecos-vault-db
```

`ecos-app` comes up on `http://localhost:7023`, `ecos-vault-db` on
`http://localhost:8090`. First access: `POST /api/v1/auth/registrar`.
To turn on the Cofre proxy in `ecos-app`, set
`ECOS_VAULT_ENABLED=true` and `ECOS_VAULT_URL=http://localhost:8090`.

## Run via Docker

```bash
cp .env.example .env   # set ECOS_NOTES_PATH
docker compose up -d                              # Notas/Tarefas only
docker compose --profile vault --profile default up -d   # + Cofre
```

Cofre activation: [`docs/README-cofre.md`](./docs/README-cofre.md).

## Known limitations of this foundation

Documented inline in the code (`// TODO` / `RISCO:` comments), not
hidden:

- **Real SQLCipher** (`app/vault`, `real-sqlcipher` feature) doesn't
  compile in this Windows dev environment — missing a full Perl for
  building the vendored OpenSSL. The production `Dockerfile` (Debian)
  installs `perl`+`build-essential` and enables the feature; without it,
  the Vault runs unencrypted — never use that mode with real financial
  data.
- Google Calendar/Microsoft Graph/Google Drive OAuth, UnifiedPush/FCM
  push, WebAuthn biometrics, and OCR (Tesseract/`leptess`) have a
  complete API contract but `TODO` logic — they depend on external
  credentials or hardware that can't be validated here.
- Direct LAN sync: pairing by code and the `dispositivo` table are real;
  mDNS announcement runs; encrypted file transfer between paired devices
  isn't implemented yet.

## License

The source code is released under the [MIT License](LICENSE). Third-party
software, fonts and icons keep their own licenses; see
[THIRD-PARTY-NOTICES](THIRD-PARTY-NOTICES) (regenerate with
`npm run licencas` in `app/client`).

The name "Ecos" and the Ecos logo/icon (`app/client/src/assets/brand`, the
favicon and `app/client/src-tauri/icons`) are trademarks of Roque Co. and are
**not** covered by the MIT License. You may fork and redistribute the code, but
please don't use the name or logo to identify your fork or imply that it is
the official Ecos. Google Calendar, Outlook and Apple Calendar are trademarks
of their respective owners and are mentioned only to indicate compatibility.
