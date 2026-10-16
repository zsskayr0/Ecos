# Análise de performance do Ecos

Objetivo: descobrir por que "a tela, o loading do Ecos ficou mais lento; tudo parece carregar". Análise apenas: nenhum código de produção foi alterado. Base analisada: `integracao-onda-4` (1b6a537); comparação de bundle com `2ebc18e`.

Os scripts de medição estão em `docs/analise-performance-medicoes/` (copiados como `.txt` para não entrarem em nenhum build).

## Resumo (a causa mais provável)

1. **O servidor trava com bibliotecas de notas de ~1.000+ itens.** `GET /notas` faz `LEFT JOIN nota_fts nf ON nf.id = n.id`. A coluna `id` da tabela FTS5 é `UNINDEXED`, então o SQLite varre a tabela FTS inteira para cada nota: custo quadrático. Medido: com 3.000 notas, `GET /notas?limit=10` levou **7,8 s (mediana; até 18 s)**; com 1.000 levou 0,9 s; com 300, 10 ms. Como o banco tem **uma única conexão atrás de um Mutex** (`db/mod.rs`), enquanto essa consulta roda *todas* as outras requisições (inclusive o guard de sessão de `/me`) esperam na fila. Isso é exatamente "tudo parece carregar".
2. **O cliente dispara essa consulta o tempo todo**: o Feed chama `GET /notas?limit=10` + `/tarefas` + `/feed` a cada 10 s, duas vezes na montagem (bug de dependência), e a cada abertura do app o `prepararConteudoOffline` baixa **todas** as páginas de notas e tarefas (10 páginas de 200 com 3.000 notas = 10 × 8 s de Mutex preso).
3. **Toda escrita reindexa a biblioteca inteira** (`reindexar_tudo`, ~27 chamadas nas rotas): 100 ms/290 ms/800 ms por POST com 300/1.000/3.000 notas, mais uma segunda reindexação disparada pelo watcher.
4. Rede/infra: sem compressão HTTP, sem `Cache-Control` nos assets, sem `max_age` no CORS (preflight a cada chamada no Tauri/Android) e o pacote principal carrega a biblioteca de ícones inteira (774 kB).

Tudo isso, exceto `/me/metricas` e a varredura de prazo em GET, **já existia em `2ebc18e`**. O que "piorou" é provavelmente o volume de dados (importador de Markdown `cc124db`, migrador do Nexus, séries recorrentes `7d697be`) cruzando um "penhasco" de cache do SQLite, mais itens novos desta rodada (tabela do achado 8).

## Método e ambiente

- Máquina de desenvolvimento Windows 11, build `--release`, sem rede real (chamadas em processo contra o roteador Axum real, mesmo harness de `tests/comum`).
- Servidor: `perf_medicao.rs` semeia N notas (~1,4 kB de corpo, 30% em 10 subpastas, com wikilinks e tags) e 2N/3 tarefas (14% com prazo hoje) como arquivos `.md`, chama `reindexar_tudo` e `ranking::executar_ciclo`, e mede cada rota via roteador (1ª chamada, mediana de 7). Também mede `EXPLAIN QUERY PLAN`, o padrão de paginação do `prepararConteudoOffline` e a contenção (pior latência de `GET /me` durante um `POST /notas`).
- Cliente: `vite build` em `2ebc18e` e em `integracao-onda-4`, com `medir-bundle.mjs` (grafo estático inicial a partir do `index.html`, gzip) e `rotas.mjs` (custo por rota). Contagem de chamadas de API por tela com vitest (`perf-medicao.test.tsx`, API mockada com latência de 20 ms, Topbar + Feed montados).

## Números

### Bundle (cliente)

| | `2ebc18e` | `integracao-onda-4` |
|---|---|---|
| JS inicial (arquivos / bruto / gzip) | 1 / 2.950 kB / **798 kB** | 3 / 1.692 kB / **424 kB** |
| CSS inicial (bruto / gzip) | 377 kB / 74 kB | 351 kB / 70 kB |
| Total de JS no `dist` | 3.785 kB (3 arquivos) | 3.876 kB (62 arquivos, 25 com < 3 kB) |
| Fontes (`woff/woff2`) | 90 arquivos, 1,4 MB (carregadas só as usadas, por `unicode-range`) | igual |

O lazy loading (`dfe72ab`) reduziu o JS inicial em 47% (gzip). Os 424 kB gz iniciais ainda têm 135 kB de `vendor-icones` (lucide inteiro, ver achado 6).

Custo por navegação (chunks novos, fora do grafo inicial, gzip): Hoje 20 kB, Agenda 52 kB, Notas 7 kB, Nota 5 kB, Tarefas 6 kB, Tarefa 7 kB, Busca 2,5 kB, Perfil 2,6 kB, Configurações 2 kB, Equipes 8 kB, Cofre 83 kB. Cada navegação pede 2 a 5 arquivos em paralelo (o Vite emite `__vitePreload` para as dependências), ou seja, ~1 RTT. Em Tauri os chunks são locais; em navegador, via LAN, a diferença é pequena. **A hipótese A existe, mas é de impacto baixo comparada às demais.**

### Chamadas de API por tela (vitest, Topbar + Feed)

| Situação | Chamadas | Detalhe |
|---|---|---|
| Montagem do Feed | **9** | `/equipes` ×2 (Topbar e Feed), `/nao-lidas` ×1, `/feed` ×2, `/notas` ×2, `/tarefas` ×2 |
| Cada `notificar()` do RefreshBus (salvar nota, capturar…) | **9** | idem |
| Poll a cada 10 s (Feed) | 3 | `/feed` + `/notas?limit=10` + `/tarefas?limit=10` (6 por minuto cada) |

O Feed carrega duas vezes porque `carregar` depende de `equipes`, e `useMinhasEquipes` devolve um array novo a cada resposta (`use-minhas-equipes.ts:46-68`): quando `/equipes` responde, a identidade de `carregar` muda e o efeito (`FeedScreen.tsx:83-88`) refaz tudo. Isso existe também em `2ebc18e` (o diff do Feed ali é só tratamento de erro e pausa offline).

### Latência dos endpoints (servidor, em processo, sem rede)

| Endpoint | N=300 notas / 200 tarefas | N=1.000 / 667 | N=3.000 / 2.000 |
|---|---|---|---|
| `GET /notas?limit=10` | 10 ms | **888 ms** | **7.810 ms** (até 18.429) |
| `GET /notas` (padrão 30) | 12 ms | 745 ms | 14.433 ms |
| `GET /notas?limit=200` (373 kB) | 14 ms | 744 ms | 8.271 ms |
| `GET /me/metricas` (Perfil) | 13 ms | **1.331 ms** | não medido |
| `GET /feed?limit=40` (86 kB) | 4 ms | 16 ms | **210 ms** |
| `GET /notificacoes/nao-lidas` | 0,5 ms (1ª: 13) | 1,5 ms (1ª: 43) | 7,5 ms (1ª: 197) |
| `GET /tarefas?limit=10` / `200` | ~0,5 / ~1 ms | ~0,7 ms | 0,8 / 3,3 ms |
| `GET /busca?q=ipsum` | 0,9 ms | 1,2 ms | 2,4 ms |
| `GET /me`, `/sync/status`, `/eventos`, `/equipes`, `/rotina/blocos` | < 0,5 ms | < 0,5 ms | < 0,5 ms |
| `GET /pastas?tipo=nota&recursivo=true` | n/m | n/m | 6 ms, **211 kB** sem paginação |
| `reindexar_tudo` (2ª execução, índice quente) | 84 ms | 389 ms | **2.514 ms** |
| `reindexar_tudo` (1ª execução, arquivos recém-criados) | 2.690 ms | 8.094 ms | **40.629 ms** (ver ressalva) |
| `POST /notas` (grava `.md` + reindexa tudo) | 92-98 ms | 276-389 ms | **783-870 ms** |
| Pior `GET /me` durante um `POST /notas` | 26 ms | 84 ms | não medido |
| `prepararConteudoOffline` só notas (páginas de 200) | 1 pág., 15 ms | 4 pág., 2,9 s | 10 pág., 3,7 MB, **42 s** |

Ressalva sobre a 1ª reindexação (2,7 s → 40 s): é 16 a 25 vezes mais lenta que a 2ª. Não consegui explicar; suspeito do antivírus do Windows varrendo arquivos recém-criados e do cache frio. Não conclua nada dela sem repetir num servidor real.

Um comportamento de "penhasco": de 300 para 1.000 notas o tempo sobe ~90×, mais do que o quadrado (11×), o que bate com o conteúdo do FTS deixar de caber no cache de páginas padrão do SQLite (2 MB). Perto do limite, o app parece normal; passando dele, tudo trava de uma vez. Isso explica por que "ficou lento" de repente.

Correção medida (SQL puro, mesmo banco): página de ids sem tocar no FTS + uma leitura de `nota_fts WHERE id IN (…)` só dos ids da página: **17.063 ms → 4,6 ms** com 3.000 notas e **1.347 ms → 2,1 ms** com 1.000.

### Planos de consulta (`EXPLAIN QUERY PLAN`)

- `notas listar`: `SCAN nf VIRTUAL TABLE INDEX 0: LEFT-JOIN` + `USE TEMP B-TREE FOR ORDER BY` (varredura do FTS por linha).
- `tarefas listar`: `SCAN t` + temp b-tree (sem índice para o `ORDER BY`, mas barato: 3 ms com 2.000).
- `varrer_prazos`: `SEARCH tarefa USING INDEX idx_tarefa_espaco (espaco=?)`, sem índice em `criado_por/status/due_date`; hoje é barato (7 ms com 2.000 tarefas), cresce linearmente.
- `nao-lidas`, guards de usuário e de sessão: índices corretos.
- `feed`: `MULTI-INDEX OR` com `LIST SUBQUERY` de `SCAN n` / `SCAN t` (toda a tabela de notas/tarefas materializada a cada chamada); aceitável (210 ms em 3.000 mais o N+1 dos cards, abaixo).

## Achados (ordenados por impacto percebido x esforço x risco)

| # | Achado | Impacto | Esforço | Risco |
|---|---|---|---|---|
| 1 | Junção FTS quadrática em `GET /notas`, `/me/metricas` e cards do Feed | Muito alto | Baixo | Baixo |
| 2 | `prepararConteudoOffline` baixa tudo a cada abertura e `guardarRespostaOffline` reescreve a coleção inteira por página | Muito alto | Médio | Médio |
| 3 | Feed carrega 2× na montagem, 9 chamadas por `notificar()`, `useMinhasEquipes` sem cache compartilhado | Alto | Baixo | Baixo |
| 4 | Toda escrita faz `reindexar_tudo` (+ watcher reindexa de novo, + boot reindexa antes de abrir a porta) | Alto | Alto | Médio |
| 5 | Banco com 1 conexão/Mutex: bloqueio de fila (head-of-line) para todas as rotas | Alto (amplifica 1-4) | Médio | Médio |
| 6 | `import * as Icons from "lucide-react"` no pacote inicial | Médio (135 kB gz) | Baixo | Baixo |
| 7 | Sem compressão HTTP, sem `Cache-Control` de assets, SW refaz download de assets com hash | Médio (rede real) | Baixo | Baixo |
| 8 | Sem `max_age` no CORS: preflight por chamada no Tauri/Android | Médio-alto em rede real | Muito baixo | Baixo |
| 9 | Feed: poll de 10 s com 3 requisições; cards de transação montados no servidor com 2 chamadas internas e descartados no cliente | Médio | Baixo | Baixo |
| 10 | `varrer_prazos` roda (e grava) em cada `GET /notificacoes[/nao-lidas]` | Baixo hoje, cresce | Baixo | Baixo |
| 11 | Guard de sessão faz 2 saltos ao banco por requisição | Baixo (amplifica 5) | Baixo | Baixo |
| 12 | Rate limit global 300/min por IP conta preflights e rajadas | Baixo-médio | Baixo | Baixo |
| 13 | Navegação: sem prefetch dos chunks de rota (hipótese A) | Baixo | Baixo | Baixo |
| 14 | `/pastas?recursivo=true` sem paginação (211 kB) chamado 2× por espaço no boot offline | Baixo | Médio | Baixo |

### 1. Junção FTS quadrática

Evidência: `app/server/src/routes/notas.rs:71` (`LEFT JOIN nota_fts nf ON nf.id = n.id` selecionando `COALESCE(nf.corpo,'')`), `routes/metricas.rs:59` (mesma junção, em `/me/metricas`, novo em `6225b4d`) e `routes/feed.rs:115-119` (por card de nota: `FROM nota_fts nf JOIN nota n ON n.id = nf.id WHERE nf.id = ?1`, uma varredura do FTS por card; 40 cards). Migração `0001_init_up.sql:115`: `fts5(id UNINDEXED, …)` não permite busca por `id`. Medição na tabela acima; plano mostra `SCAN nf VIRTUAL TABLE`.

Correção proposta (sem aplicar):
- `notas::listar`: duas consultas dentro do mesmo `db.with`. (a) ids da página: `SELECT n.id, n.titulo, ... FROM nota n LEFT JOIN usuario u ... WHERE <visível> ... ORDER BY n.atualizado_em DESC, n.id DESC LIMIT ?` sem o FTS; (b) `SELECT id, corpo FROM nota_fts WHERE id IN (?,?,…)` (≤ 201 ids) e juntar em memória por `id`. Medido: 4,6 ms em 3.000 notas.
- `feed::montar_card`: carregar de uma vez, antes do laço, o corpo/tags/autor de todos os ids de nota e tarefa da página (1 consulta por tipo) em vez de 1 `db.with` + 1 varredura de FTS por card.
- `metricas::obter`: iterar `nota_fts` uma vez (`SELECT id, titulo, corpo FROM nota_fts`) e filtrar por um `HashSet` dos ids visíveis (obtidos de `nota`), em vez de juntar linha a linha.
- Estrutural (depois): guardar o corpo pesquisável em tabela comum `nota_corpo(id PRIMARY KEY, corpo)` ou usar `fts5(content='nota_corpo', content_rowid=rowid)` e usar `rowid` na junção; o FTS passa a ser só para `MATCH`.

### 2. Preparação offline a cada abertura

Evidência: `lib/auth-context.tsx:74` e `:89` chamam `prepararConteudoOffline` após *todo* `recarregarPerfil`/`login` bem-sucedido (também após cada reconexão do laço de 3 s de `indisponivel`, `:166`). `lib/api.ts:1075-1106`: por espaço, até 20 páginas de 200 de notas **com corpo** (o endpoint devolve o corpo inteiro) e de tarefas, `pastas` recursivo dos dois tipos, `eventos` de -90/+180 dias com limite 500, mais rotina e blocos. Cada GET ainda aguarda `guardarRespostaOffline` (`api.ts:~297`): para `/notas` e `/tarefas`, `offline-store.ts:127-137` lê a coleção inteira do IndexedDB, mescla em um `Map` e **grava a coleção inteira de volta**, por página, antes de devolver a resposta ao chamador. Isso vale também para cada poll do Feed (`/notas?limit=10`), então o custo cresce com o tamanho da biblioteca no próprio navegador (clone estruturado de MBs no thread principal).

Medido (servidor): 10 páginas e 3,7 MB para 3.000 notas, serializadas por um Mutex que cada página prende por segundos.

Correção proposta:
- Rodar a preparação no máximo 1 vez por 6-24 h por espaço (timestamp em localStorage), com `requestIdleCallback`/atraso de ~5 s após o Feed renderizar, e só quando online.
- Incremental: pedir `atualizado_depois=<último sync>` (novo parâmetro) ou, no mínimo, `limit` menor e sem corpo na preparação.
- `offline-store`: trocar a coleção única `__colecao__:notas` por um registro por item (`keyPath: id`) e atualizar só os itens recebidos; não aguardar a gravação (`void guardarRespostaOffline(...)`) para não somar latência à resposta.

### 3. Feed e hook de equipes

Evidência: teste de contagem (acima) e `FeedScreen.tsx:41,83-88`, `use-minhas-equipes.ts:45-68` (17 componentes chamam `useMinhasEquipes()`, cada um com seu `fetch`; Topbar e Feed pedem `/equipes` ao mesmo tempo). `refresh-bus.tsx` incrementa `versao` em toda mutação, e cada consumidor refaz tudo.

Correção proposta: (a) `useMinhasEquipes` lê de um `EquipesProvider` único (um `GET /equipes` por `versao`, resultado compartilhado e já presente em `perfil.equipes`, que o `/me` devolve); (b) memoizar `equipes` por conteúdo (`JSON` de `id+nome+cargo`) para que `carregar` não mude de identidade quando os dados são iguais; (c) tirar `equipes`/`perfil` das dependências de `carregar` guardando-os em `useRef`. Resultado esperado: 5 chamadas na montagem (de 9) e 3 pesadas apenas uma vez; cada `notificar()` cai de 9 para 4.

### 4. Reindexação total por escrita

Evidência: `reindexar_tudo` é chamada em ~27 pontos de rotas (`notas.rs:243,297,421`; `tarefas.rs` ×9; `tarefas_serie.rs` ×4; `pastas.rs` ×4; `eventos.rs` ×6; `lixeira.rs:76` …). Ela relê **todos** os `.md` de todos os espaços e faz `DELETE` de todas as tabelas + reinserção em uma transação (`db/reindex.rs:375-446`). `jobs/watch.rs` ainda dispara outra reindexação completa ~300 ms depois de cada escrita (e varre a árvore a cada 5 s por polling). `main.rs:33` reindexa tudo **antes** de abrir a porta, então o servidor demora O(N) para responder após reiniciar (2,5 s com 3.000 notas, em regime quente). Medido: `POST /notas` 100/290/800 ms em 300/1.000/3.000 notas; `GET /me` esperou 26/84 ms durante uma escrita (o trecho da transação segura o Mutex).

Correção proposta: `reindexar_arquivo(&Path)` (e `remover_do_indice(id)`) para nota, tarefa, evento e pasta, chamada pelos handlers com o caminho que acabaram de gravar; manter `reindexar_tudo` só para boot (em segundo plano, ou com o servidor já ouvindo e `/health/ready` informando "indexando"), importação/restauração e o watcher de arquivos externos. Suprimir o watcher para caminhos escritos pelo próprio servidor (lista de "gravações recentes" com TTL de 2 s). Maior esforço da lista; fazer depois dos itens "primeiro".

### 5. Conexão única com Mutex

Evidência: `db/mod.rs:60-85` (`Arc<Mutex<Connection>>`, `spawn_blocking`). Consequência medida: durante `reindexar_tudo`/`GET /notas` lento, qualquer outra rota espera. Correção proposta: manter 1 conexão de escrita e abrir 2-4 conexões somente-leitura (WAL já está ligado, `db/mod.rs:55`) para GETs, com `PRAGMA query_only=ON`, `cache_size=-65536` (64 MB), `synchronous=NORMAL` e `temp_store=MEMORY`. Só `cache_size` já afasta o "penhasco" do cache de 2 MB, mas **não substitui** a correção 1 (a consulta continua quadrática).

### 6. Ícones no pacote inicial

Evidência: `screens/Create/TransactionForm.tsx:2` e `:67` (`import * as Icons from "lucide-react"` + busca por nome), alcançado por `AppShell → CreateFlow:16 → TransactionForm`, por isso `vendor-icones` (774 kB, 135 kB gz) está no `modulepreload` do `index.html`. Também `Vault/categorias/icone.tsx:1` e `Vault/IconPicker.tsx:2` usam o namespace, mas já ficam fora do inicial (o Cofre é lazy, `IconPicker` é lazy). Correção: em `TransactionForm`, substituir `icone(nome)` por um mapa explícito dos ~20 ícones usados (ou `React.lazy` para o `CampoCategoria`/ícone), e deixar `categorias/icone.tsx` com o namespace só dentro do chunk do Cofre. Ganho esperado: -135 kB gz (-32%) no JS inicial.

### 7. Rede: compressão e cache

Evidência: `Cargo.toml:34` (`tower-http` sem `compression-*`); `main.rs:70-76` (`ServeDir` sem `Cache-Control`; a camada de segurança só define CSP/nosniff). Resultado: o JS inicial trafega 1,69 MB em vez de ~424 kB gz; os JSON de lista (373 kB por 200 notas) também. `public/sw.js:34-41`: para assets, responde do cache **e** dispara `fetch` de rede em todo acesso (stale-while-revalidate), inclusive para arquivos com hash imutável; isso gasta banda em segundo plano competindo com a API.

Correção proposta: `tower-http` com `compression-gzip` (e `compression-br`) + `CompressionLayer`; `Cache-Control: public, max-age=31536000, immutable` para `/assets/*` e `no-cache` para `index.html`/`sw.js`; no SW, `cache-first` para `/assets/` (o hash garante frescor) e SWR só para o resto; precache da lista de chunks de rota no `install` (gerada no build) ou prefetch ocioso (achado 13).

### 8. CORS sem `max_age`

Evidência: `middleware/security_headers.rs:43-53` (`CorsLayer` sem `.max_age`). O cliente Tauri/Android é cross-origin e envia `Authorization`/`x-ecos-espaco`, logo cada requisição não-trivial faz um `OPTIONS` antes (o Chromium só guarda o preflight por 5 s por padrão). Em rede real isso dobra o RTT de quase toda chamada e dobra a contagem no rate limit (achado 12). Correção: `.max_age(Duration::from_secs(7200))` (teto do Chromium). Uma linha.

### 9. Poll do Feed e cards de transação

Evidência: `FeedScreen.tsx:38,83-88` (3 chamadas a cada 10 s; o ranking só atualiza a cada ≥ 30 s, `ranking.rs:30`, padrão 300 s). `feed.rs:158-183`: para cada `transacao` o servidor faz 2 chamadas HTTP internas ao Cofre (`/vault/transacoes/:id` e `/vault/preferencias`, esta repetida por card), e `FeedScreen.tsx:~57` descarta os itens `transacao` (`return null`). O `ranking` traz até 200 transações por usuário para `feed_item` (`ranking.rs:281`), que ocupam o limite de 40 cards. Correção: o servidor deve pular `tipo='transacao'` na consulta do Feed enquanto o cliente não tiver card (um `AND tipo != 'transacao'`), ou buscar `/vault/preferencias` uma vez por requisição; no cliente, poll de 30-60 s, só com a aba visível (`document.visibilityState`), e um único endpoint (ou ETag/`If-None-Match` em `/feed`).

### 10, 11, 12, 13, 14 (menores)

- **10.** `notificacoes.rs:105-110,123`: `varrer_prazos` (SELECT + até 1 `INSERT OR IGNORE` por tarefa vencendo, 286 por chamada no cenário medido) em cada GET de contador e de lista. Mover para o job de 30 s / de 5 min existente (`jobs/push.rs`) e criar índice `tarefa(criado_por, status, due_date)`. Hoje 7,5 ms; 1ª chamada do dia 197 ms.
- **11.** `middleware/auth_guard.rs:62-100`: dois `db.with` seguidos (usuário, depois sessão) por requisição, cada um com seu `spawn_blocking` e disputa do Mutex. Unir em uma consulta (`SELECT u.deve_trocar_senha, s.revogado_em IS NULL FROM usuario u LEFT JOIN sessao s ON s.id=?2 WHERE u.id=?1`) ou cache em memória com TTL de 5-10 s invalidado em logout/troca de senha.
- **12.** `main.rs:61`: `RateLimitLayer::new(300, 60 s)` por IP, aplicada a tudo, incluindo `OPTIONS`. Uma casa inteira atrás do mesmo IP, mais as rajadas do achado 2, aproximam-se do teto; ao estourar, o cliente mostra erro de limite. Excluir `OPTIONS` e separar um limite maior para leituras autenticadas.
- **13.** Hipótese A (lazy loading por rota): medida acima; custo por navegação de 2 a 83 kB gz. Se for tratar: em `App.tsx`, após o Feed renderizar, `requestIdleCallback(() => { import("@/screens/Today/TodayScreen"); … Agenda, Notas, Tarefas })`; prefetch em `touchstart`/`pointerenter` do `BottomNav`; opcionalmente `manualChunks` para agrupar os chunks < 3 kB (25 arquivos) e fundir `PaletaCores`/`use-espaco-filtro`/`EventoDialog`, que Hoje, Agenda e Eventos repetem como dependências separadas.
- **14.** `GET /pastas?recursivo=true` devolveu 211 kB para 3.000 notas, chamado 2× por espaço na preparação offline. Paginar ou devolver só nome/caminho/contagem.

## Hipóteses verificadas e descartadas

- Latência de `GET /me`, `/sync/status`, `/eventos`, `/equipes`, `/rotina/blocos`, `/busca` e `/tarefas`: todas abaixo de 4 ms com 3.000 notas e 2.000 tarefas. `GET /busca` usa `MATCH` e é rápido; `tarefas` não tem junção com FTS.
- Jobs de 30 s: `jobs/push.rs` consulta uma fila (vazia = no-op); `jobs/ranking.rs` roda a cada 300 s (padrão) e custa o mesmo que uma reindexação (2,8 s com 3.000 notas, segurando o Mutex em parte desse tempo). O polling do watcher (a cada 5 s) é só `stat` de arquivos, barato.
- Boot do cliente (`expirarRascunhosAntigos`, migração de foto/cores, `sincronizarPreferenciasCalendario`): são locais/assíncronos e não aparecem como gargalo na leitura do código; **não medi** em aparelho. A abertura mínima de 900 ms (`ABERTURA_MINIMA_MS`, `App.tsx:30`) só vale para quem não está logado; sessão ativa passa direto.
- Contextos grandes (`ui-context.tsx` usa `useMemo`; `auth-context` expõe `perfil` estável): sem re-render em cascata evidente. Não medi com o React Profiler.
- Listas grandes sem virtualização: não há virtualização (nenhuma ocorrência de `react-window`/`content-visibility`), mas as listas carregam 30 itens por página (limite 200 só para offline/Agenda). Não medi custo de renderização de 200 cards.

## Faça primeiro

1. **Achado 1** (`notas.rs:71`, `metricas.rs:59`, `feed.rs:115`): duas consultas em vez da junção FTS. Medido: 17 s → 4,6 ms com 3.000 notas. Baixo esforço, baixo risco, remove a principal causa do travamento.
2. **Achado 3**: estabilizar `equipes` e compartilhar `useMinhasEquipes` em um provider. Elimina a dupla carga do Feed e 4 das 9 chamadas por `notificar()`.
3. **Achado 2 (parte barata)**: limitar `prepararConteudoOffline` a 1×/dia por espaço, 5 s depois do Feed, e não aguardar `guardarRespostaOffline` nas respostas GET.
4. **Achados 8 e 7**: `.max_age(7200)` no CORS, `CompressionLayer` (gzip/br), `Cache-Control: immutable` em `/assets/*` e SW `cache-first` para assets com hash. Ganho direto em Android e rede real.
5. **Achado 6**: remover `import * as Icons` do `TransactionForm`; -135 kB gz do JS inicial.
6. **Achado 9 (parte servidor)**: o Feed deixar de montar cards de `transacao` que o cliente descarta (e deixar o poll em 30 s).

Depois (maior esforço): achado 4 (reindexação incremental), achado 5 (conexões de leitura e PRAGMAs), 10, 11, 12, 13.

## O que não consegui medir

- **WebView do Android e do desktop Tauri**: tempo até a primeira tela, custo de parse do JS, IndexedDB real. Para medir: `chrome://inspect` no aparelho (Performance e Network com throttling), `Profiler` do React em build de produção com `?profile`, e `adb shell dumpsys gfxinfo`.
- **Rede real**: toda a medição do servidor é em processo (sem TCP/TLS, sem preflight, sem compressão). Os ganhos dos achados 7 e 8 são estimados por construção, não medidos.
- **Seu volume real de dados**: usei 300/1.000/3.000 notas sintéticas de 1,4 kB. O "penhasco" depende do tamanho dos corpos; vale rodar `SELECT COUNT(*) FROM nota; SELECT SUM(length(corpo)) FROM nota_fts;` no `index.db` real. O endpoint `/metrics` (`71f015d`) em produção mostra latência por rota e confirma o diagnóstico sem novas ferramentas.
- **Contenção com 3.000 notas** e **`/me/metricas` com 3.000** (a consulta levaria dezenas de segundos); a 1ª reindexação lenta (40 s) fica sem explicação.
- **Renderização React**: não medi re-renders por componente nem custo de render de listas de 200 itens.

## Resultado após correção (servidor/infra)

Mesmo harness e dados sintéticos de antes (`perf_medicao.rs`, release, em processo). Commits na branch `worktree-agent-a9bcb02c3f3cb55c8`.

### Item 1 (8a35cbf): sem junção por `nota_fts.id`

`routes/nota_corpos.rs` lê o FTS uma vez por lote de ids; `notas::listar`, `feed::obter` e `metricas::obter` o usam. Contrato JSON igual (o teste `tests/fts_sem_juncao.rs` passa idêntico no código antigo e no novo).

| Endpoint (mediana) | 300 notas, antes → depois | 1.000, antes → depois | 3.000, antes → depois |
|---|---|---|---|
| `GET /notas?limit=10` | 10 → 0,3 ms | 888 → 0,8 ms | **7.810 → 6,4 ms** |
| `GET /notas?limit=200` | 14 → 2 ms | 744 → 2,6 ms | 8.271 → 10 ms |
| `GET /me/metricas` | 13 → 0,8 ms | 1.331 → 3,9 ms | (dezenas de s) → 11 ms |
| `GET /feed?limit=40` | 4 → 1,9 ms | 16 → 4,6 ms | 210 → 11 ms |
| `prepararConteudoOffline` (notas, lado servidor) | 15 → 2,6 ms | 2,9 s → 9,7 ms | **42 s → 102 ms** |

`PRAGMA cache_size` não foi alterado: sem a junção quadrática não há evidência de que o cache de 2 MB limite alguma rota; o "penhasco" sumiu.

### Item 2 (2ef05df): Feed sem cards de transação

Confirmado no cliente: `FeedScreen` é o único consumidor de `GET /feed` e devolve `null` para `transacao`. Agora o servidor os omite (`?transacoes=true` os devolve). Cada card poupado eram 2 chamadas HTTP internas ao Cofre, e os itens de transação deixam de ocupar o limite de 40. Não medi com o Cofre ligado (o harness roda com `vault_enabled=false`).

### Item 3 (df4fc3e): infra HTTP

CORS `max_age(7200)`; gzip (`tower-http` `compression-gzip`; o Cargo.lock ganhou `async-compression`, `compression-codecs`, `compression-core`); `/assets/*` com `public, max-age=31536000, immutable`; `index.html` e rotas do SPA com `no-cache`; `OPTIONS` fora do rate limit (400 preflights seguidos não esgotam os 300/min). Testes de cabeçalho em `tests/camadas_http.rs`. Não medi ganho de banda/latência em rede real (o harness é em processo). Brotli ficou de fora de propósito (custo de CPU em conteúdo dinâmico). Service worker e cliente intocados.

Observação nova: as rotas do SPA (`/qualquer/rota`) são servidas pelo `ServeDir` com o `index.html` mas com **status 404** (comportamento antigo, mantido). O SW só cacheia `resposta.ok` em navegação, então um deep link não entra no cache offline; vale trocar `not_found_service` por `fallback` (200).

### Item 4 (d2a6954): varredura de prazo

Depois da primeira varredura do dia por pessoa, as chaves `prazo:<id>:<data>` já gravadas ficam em memória e não são regravadas a cada `GET /notificacoes[/nao-lidas]`; tarefas novas continuam notificando (teste novo) e o `INSERT OR IGNORE` segue como garantia. Não remedi `GET /nao-lidas` depois (7,5 ms de mediana com 2.000 tarefas antes; a 1ª chamada do dia continua cara, 197 ms). A `SELECT` da varredura segue a cada GET; o índice `tarefa(criado_por, status, due_date)` exige migration e ficou de fora para não colidir com outras frentes.

### Item 5: reindexação incremental (não feito) e desenho

São ~27 pontos de chamada (`notas.rs`, `tarefas.rs` ×9, `tarefas_serie.rs` ×4, `pastas.rs` ×4, `eventos.rs` ×6, `lixeira.rs`…), com efeitos cruzados (links entre notas por título, contagem de pastas, vínculos de evento) e falta uma suíte que prove "índice incremental == índice reconstruído". Custo medido hoje: `POST /notas` 75/250/740 ms e `GET /me` esperando 12/66/217 ms durante uma escrita (300/1.000/3.000 notas): depois do item 1, é o maior gargalo restante do servidor.

Desenho proposto:
1. `reindex::reindexar_itens(db, notes_root, &[Caminho])`: relê só os `.md` informados e aplica `INSERT OR REPLACE` em `nota`/`tarefa`/`evento` (+ `nota_tag`, `nota_fts`, `links_nota` do item) numa transação curta; `remover_item(id)` para exclusões.
2. Contagem de pastas e `pasta_cache` recalculadas só para o caminho afetado e seus ancestrais; links de entrada recalculados quando um título muda (consulta por `links_nota`, não varredura).
3. Teste de equivalência: aplicar uma sequência aleatória de operações pela API e, a cada passo, comparar um dump normalizado do índice incremental com `reindexar_tudo` sobre o mesmo disco.
4. Migrar rota por rota (começando por `POST/PATCH/DELETE /notas`), mantendo `reindexar_tudo` no boot, importação, restauração e no watcher de arquivos externos; suprimir o evento do watcher para caminhos escritos pelo próprio servidor (TTL de 2 s) para acabar com a segunda reindexação por escrita.
5. Em paralelo: abrir a porta antes da reindexação inicial (`/health/ready` informa "indexando").

### Ainda aberto (cliente, com o agente C)

Feed carregando 2×, `useMinhasEquipes` sem cache, `prepararConteudoOffline` a cada abertura, `guardarRespostaOffline` reescrevendo a coleção e lucide no pacote inicial. Com o servidor corrigido deixam de travar o banco, mas ainda geram tráfego e trabalho desnecessário no WebView.
