# Ecos — Client (Tauri + React)

Ecos's complete front end, built from `ecos-prompt-execucao-frontend.md`
(brand, design system, navigation, tone of voice, and screen inventory)
and actually talking to the real backend (`ecos-app` + `ecos-vault-db`,
see `ecos-arquitetura-tecnica.md`) — no mocked data outside Onboarding.

## Run it for real (front + back)

```bash
# 1. Backend — from the repo root
cargo build -p ecos-app -p ecos-vault-db

ECOS_NOTES_PATH=./data/notes ECOS_VAULT_ENABLED=true \
  ECOS_VAULT_URL=http://127.0.0.1:8090 \
  cargo run -p ecos-app          # comes up on :7023

ECOS_VAULT_DB_PATH=./data/vault/ecos-vault.db \
  cargo run -p ecos-vault-db     # comes up on :8090, in another terminal

# 2. Frontend — in apps/client
npm install
npm run dev                       # http://localhost:1420
```

First access: the login screen has a "Criar conta" tab — it only works
**once** per instance (section 5.1: no public sign-up; after the first
user, entry is only by Team invite).

## Running as an installed app (Tauri, desktop or Android)

The browser build has a working default (`/api/v1`, proxied by Vite or
served same-origin) — the compiled Tauri shell doesn't, since its WebView
has no meaningful "same origin" as wherever `ecos-app` runs. First launch
shows a **Servidor** screen (also reachable later from Configurações →
Servidor) where you type the real address — usually your PC's LAN IP on
port 7023 (e.g. `http://192.168.1.50:7023`), or a Tailscale/tunnel address
if you have one. Saved locally (`server-config.ts`), no rebuild needed to
change it.

Backend requirement for this to work: `ecos-app`'s CORS layer
(`middleware/security_headers.rs::cors_mesma_origem`) explicitly allows
the Tauri WebView's own origins (`tauri://localhost`,
`http://tauri.localhost`, `https://tauri.localhost`) with credentials —
without that, the session cookie never survives the cross-origin request
and every call comes back 401.

Building the Android APK (tested working on this machine — Android SDK,
NDK 28.2, and the four `*-linux-android` Rust targets already installed):

```bash
cd apps/client
npx tauri android init                       # once, generates gen/android
npx tauri android build --debug --apk --target aarch64
# → src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

Two real fixes were needed to get this far, not just config:
`src-tauri` never had a `src/lib.rs` (mobile targets link against a
library, not a `main()` binary — added it, with `main.rs` reduced to
calling `ecos_client_lib::run()`), and `src-tauri/Cargo.toml` needed an
explicit empty `[workspace]` table — without it, Cargo treats the crate as
an unlisted member of the repo root's workspace and refuses to build it
standalone, even though it was never in `members`.

## What's real (not mocked)

The full CRUD against the real `ecos-app`/`ecos-vault-db`, via
`src/lib/api.ts` (types matching the real routes, read straight from
`apps/server/src/routes/*` and `apps/vault/src/routes/*`, not just the
paper architecture):

- **Auth**: register (once), login, logout, `PATCH /me`.
- **Notas**: list by folder, create, read, edit, mark reviewed, delete.
- **Tarefas/Agenda**: create, edit, change status, delete, `GET /agenda/capacidade` (real — closes GAP-03 from the mock round). Tarefa now carries prioridade (also boosts its Feed score — `ecos_core::ranking::boost_tarefa_prioridade`), tags, subtarefas, a real Markdown description, folders (`_anexos`-style, mirroring Nota), and file attachments (`_anexos/<id>/`, real upload/download). Agenda has Mês/Semana/Dia views over the same day-list.
- **Feed**: `GET /feed`, real ranking job result (score/motive actually computed).
- **Busca**: real FTS5 for Notas/Tarefas; Transações filtered client-side (no server-side search for those).
- **Pastas**: list, create.
- **Equipes**: create, join by invite, list members, profile, invite.
- **Notificações**: list, mark read/mark all read.
- **Cofre**: activate (first password), unlock, balance per account, categories, accounts, transactions (create/edit/delete).

The only thing still decorative: the **Onboarding** mini-components
(`src/screens/Onboarding`), which use `src/lib/mock-data.ts` on purpose —
depending on network/session to show a slide wouldn't make sense.

## Real bugs found testing against the backend (fixed here)

None of these existed until integrating for real — they only show up with
a real backend on the other end:

1. **GAP-13** — `POST /captura` (section 11.3) can't be used to create a
   Transacao: the outer discriminator `tipo` collides by name with
   `TransacaoPayload`'s own `tipo` (entrada/saida). `campos_compativeis()`
   also never lists "tipo" for transacao — a sign that the right path is
   to go straight through `POST /vault/transacoes`. Fixed in `CreateFlow.tsx`.
2. **GAP-14** — a Transacao with no `conta_id` never shows up in
   `saldos_por_conta` (`GET /vault/config` sums per account). The quick
   Capture form (section 3.6) doesn't ask for an account explicitly —
   `TransactionForm` now silently auto-selects the default Conta (or the
   first one that exists).
3. A stale closure in the Transacao calculator's keypad (fast-typed
   digits got dropped) — functional `setDraft` instead of a direct spread.
4. **GAP-11 closed** — added `GET /tarefas/:id`, mirroring `notas::obter`.
5. `tarefa` never had a `pasta_id` column (unlike `nota`) even though
   `pastas.rs`'s `tipo == "tarefa"` branch and `tarefas::listar`'s `pasta`
   filter both already assumed one — `GET /pastas?tipo=tarefa` and
   `GET /tarefas?pasta=X` silently errored (`no such column: pasta_id`)
   every single time, just never exercised by any screen until Tarefa
   folders (this round) actually called them. Fixed in migration `0002`
   (`pasta_id TEXT` + populated by `reindex.rs`), not worked around in the
   client.

## Note about this development machine (not an app bug)

Two environment gotchas found while testing this session, documented
here so they don't repeat:

- **Docker Desktop/WSL2 already uses port 7023 via `::1`** —
  `com.docker.backend.exe`/`wslrelay.exe` respond on `[::1]:7023` on this
  machine (probably some other project's container published on that
  port). Since "localhost" resolves to `::1` first here, hitting
  `http://localhost:7023` could land on that wrong service instead of
  `ecos-app`. Mitigated by using explicit `127.0.0.1:7023` in Vite's proxy
  (`vite.config.ts`) — but it's worth checking
  `netstat -ano | findstr 7023` before assuming the port is free on a
  machine running Docker.
- **This sandbox's embedded preview blocks POST/PUT/PATCH/DELETE**
  fired by `fetch()` from inside the page (confirmed by testing: GET goes
  straight to the real backend, any other verb comes back as a synthetic
  404 with permissive CORS, not coming from Rust). This doesn't affect
  real users — it just meant the login/Capture flow couldn't be
  click-tested visually inside this session; the integration was
  validated via `curl` straight against `ecos-app` (register, login,
  Nota/Tarefa/Transacao CRUD, Feed, Busca, Equipes — all checked line by
  line against what `src/lib/api.ts` expects).

## Gaps still flagged (never decided silently)

Searchable by `GAP-0N` in the code:

- **GAP-01** — the Feed's pull-to-search became a fixed shortcut (no native gesture on web/desktop).
- **GAP-02** — reading/editing a Nota isn't one of the 12 screens in the inventory; built as the minimal, honest destination for tapping the card.
- **GAP-04** — "Notificações"/"Aparência"/"Sobre" in the Settings index with no detailed content in the spec.
- **GAP-05** — the "Criar ou entrar numa Equipe" flow wasn't in the inventory — real now (`POST /equipes`, `POST /convites/:codigo/aceitar`).
- **GAP-06** — light mode palette: only `--ecos-text-primary-light` is official; secondary/muted are interpolated.
- **GAP-08** — `equipe` has no color field in the real schema — identity color derived from the id (`src/lib/team-color.ts`), never violet (exclusive to the Vault).
- **GAP-09** — ranking motive (Frescor/Órfã/...) only exists for Feed items; folder listing has no such data per standalone Nota.
- **GAP-10** — `GET /pastas` doesn't return `espaco` per subfolder — no Personal/Team color in the Notas grid.
- **GAP-12** — `membro_equipe` only stores `usuario_id`/`cargo`, no name/handle — other members show up by id, never a made-up name.
- **GAP-15** — Tarefa anexos follow Nota's own convention exactly (sibling file under `_anexos/<id>/`, referenced from `corpo` via a relative Markdown link — never a separate structured list); there's no delete endpoint, since removing the reference line from `corpo` *is* removing the anexo, same as any other line of text. The file itself is only cleaned up when the whole Tarefa is deleted.
- **GAP-16** — the custom `DatePicker` (`components/common/DatePicker.tsx`) replaces the browser's native `<input type="date">` popup everywhere a date is picked (Transacao, Tarefa) — not spec'd explicitly (the design doc only asks for "fácil de mudar"), built to match the rest of the design system instead of carrying OS chrome into the app.
- **GAP-17** — real bug, found from user feedback ("como vou visualizar o resto delas?"): `NotesRootScreen`/the new `TaskFoldersRootScreen` only ever rendered `subpastas` — a Nota/Tarefa with no folder was invisible while browsing (still showed up in Feed/Busca, just not here). Both screens now also fetch and list loose items under a "Sem pasta" heading, in whichever view mode (Cards/Lista) is selected.
- **GAP-18** — real bug: `AppShell`'s topbar allowlist was an exact 4-path match (`/feed`, `/notas`, `/agenda`, `/cofre`) — one level deeper (`/notas/pasta/:id`, and now `/tarefas`/`/tarefas/pasta/:id`) silently lost the avatar/notifications. Fixed with a path-prefix check instead of an exact list.
- **GAP-19** — Nota/Tarefa never recorded who created them (only Transacao did, via the Vault's own `criado_por`). Added the same column + a real author to both (migration `0003`, `notas`/`tarefas::criar` now take `Extension<UsuarioAutenticado>`) — surfaced as an avatar+name row under every Feed/folder card. Items created before this migration have `criado_por: null`; the client falls back to the current user for `espaco: pessoal` (this instance's only possible author) and shows "Equipe" for a legacy Team item with no recorded author, rather than inventing a name.
- Section 3.5 vs. rule 7 conflict: the Vault balance is in JetBrains Mono (general rule) instead of Space Grotesk (one-off mention) — decision documented in `VaultScreen.tsx`.

## Tauri

`src-tauri/` has the desktop shell's skeleton (Tauri v2). It hasn't been
compiled/tested in this environment — see the comments in
`src-tauri/Cargo.toml`. To run it: `npm run tauri dev` (requires
`@tauri-apps/cli` and a GUI toolchain — WebView2 on Windows). Current
icons are a solid-color placeholder; generate real ones with
`npx tauri icon <source>` before a distribution build.
