# Ecos — Client (Tauri + React)

Front-end completo do Ecos, construído a partir de `ecos-prompt-execucao-frontend.md`
(marca, sistema de design, navegação, tom de voz e inventário de telas) e
falando de verdade com o backend real (`ecos-app` + `ecos-vault-db`, ver
`ecos-arquitetura-tecnica.md`) — sem dados mockados fora do Onboarding.

## Rodar de verdade (front + back)

```bash
# 1. Backend — na raiz do repo
cargo build -p ecos-app -p ecos-vault-db

ECOS_NOTES_PATH=./data/notes ECOS_VAULT_ENABLED=true \
  ECOS_VAULT_URL=http://127.0.0.1:8090 \
  cargo run -p ecos-app          # sobe em :7023

ECOS_VAULT_DB_PATH=./data/vault/ecos-vault.db \
  cargo run -p ecos-vault-db     # sobe em :8090, num outro terminal

# 2. Frontend — em apps/client
npm install
npm run dev                       # http://localhost:1420
```

Primeiro acesso: a tela de login tem aba "Criar conta" — só funciona
**uma vez** por instância (seção 5.1: sem cadastro público; depois do
primeiro usuário, entrada só por convite de Equipe).

## O que é real (não mockado)

Todo o CRUD contra `ecos-app`/`ecos-vault-db` de verdade, via
`src/lib/api.ts` (tipos batendo com as rotas reais lidas direto de
`apps/server/src/routes/*` e `apps/vault/src/routes/*`, não só a
arquitetura em papel):

- **Auth**: registro (uma vez), login, logout, `PATCH /me`.
- **Notas**: listar por pasta, criar, ler, editar, marcar revisado, apagar.
- **Tarefas/Agenda**: criar, editar, mudar status, apagar, `GET /agenda/capacidade` (real — fecha o GAP-03 da rodada de mock).
- **Feed**: `GET /feed`, resultado do job de ranking real (score/motivo calculados de verdade).
- **Busca**: FTS5 real pra Notas/Tarefas; Transações filtradas client-side (não há busca server-side pra elas).
- **Pastas**: listar, criar.
- **Equipes**: criar, entrar por convite, listar membros, perfil, convite.
- **Notificações**: listar, marcar lida/todas lidas.
- **Cofre**: ativar (primeira senha), desbloquear, saldo por conta, categorias, contas, transações (criar/editar/apagar).

Único dado ainda decorativo: os mini-componentes do **Onboarding**
(`src/screens/Onboarding`), que usam `src/lib/mock-data.ts` de propósito —
não fazem sentido depender de rede/sessão pra mostrar um slide.

## Bugs reais encontrados testando contra o backend (corrigidos aqui)

Nenhum destes existia até integrar de verdade — só aparecem com um backend
real na outra ponta:

1. **GAP-13** — `POST /captura` (seção 11.3) não dá pra usar pra criar
   Transação: o discriminador externo `tipo` colide de nome com o `tipo`
   (entrada/saida) de `TransacaoPayload`. `campos_compativeis()` também
   nunca lista "tipo" pra transacao — sinal de que o caminho certo é ir
   direto em `POST /vault/transacoes`. Corrigido em `CreateFlow.tsx`.
2. **GAP-14** — uma Transação sem `conta_id` nunca aparece em
   `saldos_por_conta` (`GET /vault/config` soma por conta). O formulário de
   Captura rápida (seção 3.6) não pede conta explicitamente — `TransactionForm`
   agora auto-seleciona a Conta padrão (ou a primeira existente) em silêncio.
3. Closure obsoleta no teclado da calculadora de Transação (dígitos digitados
   rápido se perdiam) — `setDraft` funcional em vez de spread direto.

## Nota sobre esta máquina de desenvolvimento (não é bug do app)

Duas pegadinhas de ambiente encontradas ao testar nesta sessão, documentadas
aqui pra não se repetirem:

- **Docker Desktop/WSL2 já usa a porta 7023 via `::1`** — `com.docker.backend.exe`/`wslrelay.exe`
  respondem em `[::1]:7023` nesta máquina (provavelmente algum container de
  outro projeto publicado nessa porta). Como "localhost" resolve pra `::1`
  primeiro aqui, acessar `http://localhost:7023` pode cair nesse serviço
  errado em vez do `ecos-app`. Mitigado usando `127.0.0.1:7023` explícito no
  proxy do Vite (`vite.config.ts`) — mas vale checar `netstat -ano | findstr 7023`
  antes de assumir que a porta está livre numa máquina com Docker rodando.
- **O preview embutido deste ambiente de sandbox bloqueia POST/PUT/PATCH/DELETE**
  disparados por `fetch()` de dentro da página (confirmado testando: GET
  passa direto pro backend real, qualquer outro verbo volta um 404 sintético
  com CORS permissivo, não vindo do Rust). Isso não afeta usuários reais —
  só significa que o fluxo de login/Captura não dava pra clicar-testar
  visualmente dentro desta sessão; a integração foi validada via `curl`
  direto contra `ecos-app` (registro, login, CRUD de Nota/Tarefa/Transação,
  Feed, Busca, Equipes — tudo conferido linha a linha contra o que
  `src/lib/api.ts` espera).

## Lacunas ainda sinalizadas (não decididas em silêncio)

Buscáveis por `GAP-0N` no código:

- **GAP-01** — pull-to-search do Feed virou atalho fixo (sem gesto nativo em web/desktop).
- **GAP-02** — leitura/edição de Nota não é uma das 12 telas do inventário; construída como destino mínimo e honesto do toque no card.
- **GAP-04** — "Notificações"/"Aparência"/"Sobre" no índice de Configurações sem conteúdo detalhado na especificação.
- **GAP-05** — fluxo de "Criar ou entrar numa Equipe" não estava no inventário — real agora (`POST /equipes`, `POST /convites/:codigo/aceitar`).
- **GAP-06** — paleta light mode: só `--ecos-text-primary-light` é oficial; secondary/muted interpolados.
- **GAP-08** — `equipe` não tem campo de cor no schema real — cor de identidade derivada do id (`src/lib/team-color.ts`), nunca violeta (exclusivo do Cofre).
- **GAP-09** — motivo de ranking (Frescor/Órfã/...) só existe pra itens do Feed; listagem de pasta não tem esse dado por Nota avulsa.
- **GAP-10** — `GET /pastas` não devolve `espaco` por subpasta — sem cor Pessoal/Equipe na grade de Notas.
- **GAP-11** — não existe `GET /tarefas/:id` — a tela de detalhe busca na primeira página de `GET /tarefas` e procura pelo id (ok na escala pessoal do Ecos, não é uma consulta direta).
- **GAP-12** — `membro_equipe` só guarda `usuario_id`/`cargo`, sem nome/handle — outros membros aparecem pelo id, nunca um nome inventado.
- Conflito seção 3.5 vs. regra 7: saldo do Cofre em JetBrains Mono (regra geral) em vez de Space Grotesk (menção pontual) — decisão documentada em `VaultScreen.tsx`.

## Tauri

`src-tauri/` tem o esqueleto do shell desktop (Tauri v2). Não foi
compilado/testado neste ambiente — ver comentários em `src-tauri/Cargo.toml`.
Pra rodar: `npm run tauri dev` (exige `@tauri-apps/cli` e toolchain de GUI —
WebView2 no Windows). Ícones atuais são placeholder de cor sólida; gere de
verdade com `npx tauri icon <fonte>` antes de um build de distribuição.
