# Auditoria UI/UX + Front-end — Ecos (ecos-app)

## Contexto do plano
Auditoria estática (leitura de código) do cliente `app/client` (React+Vite+Tailwind+Tauri, pt-BR), do backend Axum (`app/server`, `app/vault`) e de `docs/STATUS.md`. Este arquivo É o relatório. Após aprovação, será gravado como `ecos-app/docs/AUDITORIA-UIUX.md` (único arquivo criado; nenhum código alterado). Os quick wins da seção 7 só serão implementados se você pedir depois.

---

## 1. Sumário executivo

1. 🔴 **UI mente sobre o estado do sistema.** `SincronizacaoBackup.tsx` mostra "Tudo sincronizado / há 3 min / 1.8 GB de 10 GB" fixos, com Exportar/Restaurar sem handler. `PrivacyVaultScreen.tsx:102-103,170`: toggles "Biometria obrigatória" (ligado por padrão) sem efeito; biometria não existe; botão "Apagar permanentemente" sem `onClick`; frase de confirmação da UI ("apagar meu cofre") diverge do backend ("APAGAR TUDO", `vault/routes/reset.rs:24`).
2. 🔴 **Perda de dados silenciosa:** eventos da Agenda vivem só em memória (`eventos-locais.ts:11`) mas são misturados a dados persistidos em Hoje. Autosave de 600 ms cria nota/tarefa "fantasma" ao primeiro caractere (`CreateFlow.tsx:268`). Rascunho de transação do Cofre em `localStorage` em texto claro.
3. 🔴 **Autorização de equipes incompleta no backend** (fato, `equipes.rs`, demais rotas): notas/tarefas/media/lixeira não checam pertencimento à equipe; `GET /equipes/:id`, `/membros` e `POST /convites` sem checagem; `aceitar_convite` ignora `expira_em`; admin pode promover a dono; `rotina` e `sync/dispositivos` sem escopo por `usuario_id`. Hoje mitigado por uso single-user (registro só 409 após 1º usuário). Não há caminho para criar o usuário nº 2.
4. 🟠 **Contraste:** `text-muted` = 4.01:1 (dark) / 3.91:1 (light) no fundo base e 3.15–3.60 nas superfícies — reprova AA; usado 368×, 18× ao lado de `text-[9-11px]`. Branco sobre gradiente ciano→violeta do FAB = 1.67–2.72:1. Borda de inputs 1.26–1.46:1 (exige 3:1). Tema light deixa 5 cores de domínio nos valores do dark (1.50–3.38:1).
5. 🟠 **Acessibilidade estrutural:** sem `:focus-visible` global (38 usos p/ 304 botões e 65 inputs; `.ecos-input:focus{outline:none}`); `Drawer` sem role/Esc/trap/foco; 15 de 16 `role="dialog"` sem trap; `BottomNav` com alvo ≈22 px e sem rótulo visível; arrastar (abas/tarefas) só por ponteiro; nenhum `prefers-color-scheme`.
4b. 🟠 **Estados de erro ausentes:** 5 telas ficam em "Carregando…"/"Buscando…" para sempre se a chamada falha (`NotesRootScreen:75`, `TaskFoldersRootScreen:70`, `NotificationsScreen:107`, `SearchScreen:320`, TeamProfile); 0 telas tratam offline num app local-first; Cofre trata falha de rede como "bloqueado"; nota trata qualquer erro como "sumiu".
6. 🟠 **Bug funcional:** "Duplicar tarefa" navega para `/tarefas/:id`, mas a rota é `/tarefa/:id` → cai em `/feed` (`TaskDetailScreen.tsx:132` × `screen-routes.tsx:171`). `ServerConfigScreen.tsx:210-221` grava o endereço antes de testar, sem reverter → app pode ficar inacessível. Classe `bg-surface-raised` inexistente (`AppShell.tsx:96`, `ReceptorCompartilhamento.tsx:50`) → toast sem fundo.
7. 🟡 **Performance:** bundle único de 2.04 MB (0 `React.lazy`; pdfjs importado estático em `FileViewerScreen`), sem virtualização de listas, animações infinitas com `drop-shadow`/blur no login.
8. 🟡 **Débito visual:** 304 `<button>` crus com classes coladas; sem `Button/Input/Modal` primitivos; 5 padrões de modal, ≥6 de menu, 3 date pickers; ~400 raios ad hoc vs 9 usos do token; 79 `style={{}}`; 143 hex fora de tokens; sem Storybook, sem teste visual/axe; testes só em Agenda/Hoje.
9. 🟢 **Pontos fortes reais (manter):** `Toggle`, `MenuSuspenso`, `ConfirmDeleteDialog` (`<dialog>`), reduced-motion bem coberto, token só em memória p/ access token, `lang="pt-BR"`, zoom liberado, rollback otimista na Agenda, rate-limit com contagem regressiva, recovery key com confirmação.

---

## 2. Escopo
**Analisado:** todo `app/client/src` (screens, components, desktop, lib, styles), `tailwind.config.cjs`, `vite.config.ts`, `index.html`, rotas e handlers do servidor e do vault, migrations, `error.rs`, `docs/STATUS.md`, README.
**Fora / não verificado:** execução em runtime (sem screenshots, Lighthouse, Core Web Vitals reais), dispositivo Android, leitores de tela, testes com usuários, Figma/Design System (não existe no repo), métricas de negócio. Contrastes foram **calculados dos hex dos tokens**, não medidos na tela. Itens **[H]** = hipótese.
**Suposições declaradas:** público = uso pessoal/pequenas equipes self-hosted; plataformas = Tauri desktop + Android + web; fase 0.x alpha.

---

## 3. Inventário (resumo)

| Tela | Rota | Componentes principais | Estados (L/V/E/Off) | Prio |
|---|---|---|---|---|
| Conectar servidor / Auth | AuthGate | ConectarServidor, AuthScreen | L,E / sem "esqueci senha" | Alta |
| Feed | /feed | CapturaRapida, ListaDeItens | L,V,E / Off ✗ | Alta |
| Hoje | /hoje | TodayScreen | L,V,E | Alta |
| Agenda | /agenda | AgendaScreen 671l, GradeTempo 819l | L,V,E | Alta |
| Tarefa detalhe | /tarefa/:id | TaskComposer | L,V,E | Alta |
| Tarefas / Notas (raiz) | /tarefas, /notas | FoldersRoot | **E ✗ (trava)** | Alta |
| Nota detalhe | /notas/nota/:id | NoteDetail | E confunde com 404 | Média |
| Busca | /busca | SearchScreen | **E ✗** | Média |
| Cofre | /cofre | VaultScreen, VaultLock | rede→"bloqueado" | Alta |
| Equipes | /equipes, /configuracoes/equipes | TeamProfile (usa `alert()`) | L,E | Média |
| Config. (13 sub-rotas) | /configuracoes/* | Sync (mock), Privacidade (inerte) | — | Alta |
| Lixeira / Notificações / Ajuda / Media | … | … | Notif. sempre vazia (ninguém produz) | Baixa |
| Órfãos | Onboarding, FoldersScreen, PlaceholderScreen | — | não roteados | Remover/religar |

Duas shells: mobile `AppShell` (BottomNav 5 itens + Drawer) e desktop `DesktopShell` (Rail, abas, painéis, Ctrl+K), compartilhando `routes/screen-routes.tsx`.

---

## 4. Achados por categoria

### 4.1 UX (severidade | heurística | evidência → recomendação | esforço)
- **UX-01 🔴 Status falso (Sync/Privacidade)** | H1, H5 | arquivos acima → remover/rotular "Em breve" ou ligar a `/sync/status`; desativar toggles inertes | P
- **UX-02 🔴 Eventos da Agenda efêmeros** | H5 | `eventos-locais.ts:11`, `TodayScreen.tsx:23` → badge "Só nesta sessão" nos cards ou persistir | P (badge) / G (persistir)
- **UX-03 🟠 Autosave cria itens fantasma** | H5 | `CreateFlow.tsx:268` → só criar após título/corpo ≥ N chars ou blur; ao fechar vazio, descartar | M
- **UX-04 🟠 "Carregando…" infinito (5 telas)** | H1, H9 | listas ficam `null` no erro → estado `erro` + botão "Tentar de novo" (componente único `ErroCarregar`) | P
- **UX-05 🟠 Offline inexistente** | H1 | 0 ocorrências de `onLine` → banner "Sem conexão" + fila de escrita | M/G
- **UX-06 🟠 Erro de rede tratado como "sumiu"/"bloqueado"** | H9 | `NoteDetailScreen.tsx:52`, `VaultScreen.tsx:143` → só 404 = "sumiu"; `CONEXAO_INDISPONIVEL` = "Sem conexão" | P
- **UX-07 🟠 Sem desfazer** | H3 | 0 toasts com ação; `ConfirmDeleteDialog` não diz que vai à Lixeira → toast "Desfazer" (5 s) + texto "Vai para a Lixeira" | M
- **UX-08 🟠 Duplicar tarefa leva ao Feed** | H5 | `TaskDetailScreen.tsx:132` → `/tarefa/${id}` | P
- **UX-09 🟠 Endereço do servidor sem rollback** | H5 | `ServerConfigScreen.tsx:210` → testar antes de gravar (como `ConectarServidorScreen:186`) | P
- **UX-10 🟠 Sem "Esqueci a senha"**; recovery key mostrada mas sem uso | H9/H10 | `recuperar-senha` existe no backend (`auth/mod.rs:266`) → tela + explicar para que serve a chave | M
- **UX-11 🟠 Cofre: promessa de biometria e de recovery key não cumprida**; sem auto-bloqueio | H2/H5 | `VaultLockScreen.tsx:53`, README-cofre → trocar ícone/texto p/ "senha do Cofre"; auto-lock por inatividade | M
- **UX-12 🟡 IA:** "Hoje" fora do BottomNav (2 toques); ordem mobile≠desktop; Ajuda/Busca/Notificações sem entrada visível no desktop; Voltar Android sempre vai a `/feed` (`AppShell.tsx:56`) | H4 | → trocar Busca↔Hoje na barra ou 5º+; Voltar = `rotaPai()` | M
- **UX-13 🟡 Captura rápida no toque:** Enter=nota, Ctrl+Enter=tarefa, hint `Ctrl+↵` mostrado em touch | H7 | esconder hint em touch; botões explícitos | P
- **UX-14 🟡 Logout sem confirmação** (Drawer, menu, paleta) | H5 | confirmar se há rascunho pendente | P
- **UX-15 🟡 Formulários pesados:** `TransactionForm` (9 campos, teclado numérico longe do valor), `TaskComposer` (11 grupos), `EditorEvento` (repetição configurável mas não expandida na grade) | carga cognitiva | valor primeiro/fixo no topo; ocultar recorrência até existir | M
- **UX-16 🟢 Busca:** "atalhos rápidos" só preenchem texto; status cru `{t.status}` (`SearchScreen.tsx:338`); sem limpar recentes.
- **UX-17 🟢 Sem dark patterns intencionais** encontrados.

### 4.2 Microcopy (fatos)
- Jargão de dev ao usuário: "O ecos-app está rodando?" (`FeedScreen:75`, `CreateFlow:259`, `ReceptorCompartilhamento:307`); "quando o endpoint de senha estiver disponível" (`EditarPerfilScreen:65`); "(seção 5.1)" e "Rust em toda a base" (`AboutScreen:24-25`); `ECOS_VAULT_ENABLED=true` (`VaultScreen:256`).
- Genéricas: "Não foi possível salvar/buscar/carregar/apagar." sem causa nem próximo passo.
- Aspas literais renderizadas: `TaskComposer.tsx:166` (`"Agenda, subtarefas e organização"`).
- Terminologia: **Media**/mídia; **Espaço**/Equipe/Pessoal/Workspace; **Lixeira** ×3 nomes; Excluir/Apagar/Remover; tarefa/etapa/subtarefa; "Sincronização & Backup" (FAQ) ≠ "Servidor e backup" (menu).
- Tom: "Preenche…" (informal) × "Confira…" (formal) × "Não consegui…" (1ª pessoa); "pra/para"; "..." × "…".
- Senha: espaços removidos silenciosamente (`AuthScreen:165`) — só o placeholder avisa; botão desabilitado sem dizer por quê (`VaultLockScreen:83`).

### 4.3 UI / Design System
| Item | Estado | Evidência |
|---|---|---|
| Tokens de cor | ⚠️ Inconsistente | tokens definidos; 143 hex e 11 rgba fora; 5 cores sem override light |
| Escala tipográfica | ❌ Ausente | 60× `text-[15px]`, 29× `[10px]`, 3× `[9px]` |
| Espaçamento | ⚠️ | 173 valores arbitrários `[Npx]` |
| Raio / sombra | ⚠️ | token `card` usado 9× vs ~400 ad hoc; 1 token de sombra |
| Motion tokens | ❌ | ≥7 durações e ≥6 beziers hardcoded |
| Botões | ❌ | 304 `<button>` crus; alturas h-7…min-h-12 sem escala |
| Inputs | ⚠️ | `.ecos-input` em 40 de 76 campos |
| Modais / menus / pickers | ⚠️ | 5 / ≥6 / 3 implementações |
| Toggle, MenuSuspenso, Confirm | ✅ | bem feitos |
| Ícones | ⚠️ | Semana e Anual usam o mesmo `CalendarDays` |
| Responsividade | ⚠️ | `max-w-md` em tablet retrato; `100vh` ×7 vs `dvh` ×2; scrollbar oculta globalmente; FAB sem safe-area |
| Tema | ⚠️ | ignora `prefers-color-scheme`; `index.html` fixa dark |

Contraste calculado (dark / light, fundo base): muted 4.01 / 3.91 ✗; steel-500 4.04 ✗; cyan light 4.08 ✗; success/warning light 4.50 no limite; borda 1.46 / 1.53 ✗ (3:1).

### 4.4 Backend ↔ Front (gap analysis)
| Recurso | Exposto na UI? | Classe |
|---|---|---|
| `POST /auth/recuperar-senha` | ❌ (sem wrapper) | 🧩 (alta prioridade) |
| `DELETE /me`, `GET /me/export` | ❌ | 🧩 |
| `/sync/*` (dispositivos, config, push) | ❌; tela é mock | 🧩 / 🚨 pelo mock |
| `/calendario/config`, `DELETE` | ❌; conectar/callback = 501 | 🧩 / 🗑️ stubs |
| `GET /notas/:id/links` (backlinks) | ⚠️ wrapper sem consumidor | 🎁 |
| `PATCH/DELETE /equipes/:id/membros/:uid` | ⚠️ wrapper sem consumidor; UI mostra ids curtos (`TeamProfileScreen:22`) | 🎁 |
| Vault: editar/excluir conta e categoria | ❌ | 🎁 |
| Vault: recorrências, pendências, backup/CSV, anexos, exclusão em lote, status | ❌ | 🧩 |
| Vault: captura-foto (OCR) | ❌; backend devolve rascunho vazio | 🗑️ até existir OCR |
| `/captura*`, `/documentos/:hash`, `/notas/:id/pagina` | ❌ sem consumidor | 🗑️ candidatos |
| `/notificacoes` | ✅ mas **nada produz notificações** → sempre vazia | 🧩 |
| `/usuarios/:id/avatar` | ❌ (membros sem avatar) | 🎁 |
| Time entries `tipo: real` | sem UI de registro real | 🧩 |
| `ultima_revisao_em` / fluxo "Órfã" | tipado, sem UI clara | 🧩 |

**Validação/erros:** cliente sem `minLength/maxLength` em nenhum input; senha: servidor conta bytes (`.len()`) e exige sem espaços, cliente só `≥8`; erros do servidor chegam como `campo: motivo` com nomes snake_case (`duration_min`, `nome_usuario`); `error.code` nunca usado; `retry_after` só no Auth; `VAULT_LOCKED` menciona biometria inexistente; `PATCH /equipes/:id` aceita nome vazio; `duration_min` não pode ser limpo por PATCH.
**Riscos 🚨:** itens 1 e 3 do sumário; `.apk` na raiz não ignorados pelo git (`git add .` os commitaria); `mock-data` no bundle via `OnboardingScreen` (órfão).

### 4.5 Acessibilidade (WCAG 2.2 AA)
| Critério | Violação | Correção |
|---|---|---|
| 1.4.3 Contraste texto | muted, steel-500, cyan/success/warning light | escurecer/clarear tokens (ver §7) |
| 1.4.11 Contraste UI | bordas 1.26–1.46, branco s/ ciano | borda ≥3:1 nos controles; texto escuro no FAB/ciano |
| 2.4.7 / 2.4.11 Foco | sem `:focus-visible` global; `outline:none` | regra global (§7) |
| 2.1.1 Teclado / 2.5.7 Arrastar | drag de abas e tarefas só por ponteiro | menu "Mover para…" / setas |
| 4.1.2 Nome/role/valor | Drawer sem `role="dialog"`; scrim é `<button>` focável; nav sem `aria-label` | `<dialog>`/inert + Esc + retorno de foco |
| 2.5.8 Alvo | 28–36 px em vários botões; BottomNav ≈22 px | ≥44 px (mobile) |
| 1.3.1 / 3.3.2 Labels | 42 `<label>`, 4 `htmlFor` p/ 65 inputs [H: vários só por placeholder] | auditar campo a campo |
| 4.1.3 Mensagens de status | sem sistema de toast; erros com `role=alert` em ~6 pontos | `LiveRegion` + `Toast` |
| 1.4.4 Redimensionar | ok (zoom liberado), mas 61 fontes <12 px em px fixo | mínimo 12 px em rem |
| 2.3.3 Movimento | ✅ bem coberto; faltam `ecos-fade-in`/`item-entra` | incluir no bloco |
| Leitores de tela | **não testado** | teste NVDA/TalkBack |

### 4.6 Performance percebida (só estática; medir LCP/CLS/INP em runtime)
- Bundle principal **2.04 MB** + worker pdf 1.4 MB; 0 lazy; sem `manualChunks`.
- Fontes: 6 pesos, todos os subsets no CSS; sem preload/`font-display` controlado.
- Sem virtualização (Feed/Tabela). Feed faz poll a cada 10 s (`FeedScreen:35`).
- `<img>` sem width/height → risco de CLS. `100vh` ×7.
- Login: loops infinitos com `drop-shadow` duplo e blur 70 px [H: pesado em WebView low-end].
- Otimismo presente (Hoje, Agenda, autosave); ausente em Lixeira, Equipes, Perfil, Cofre.

### 4.7 Débito técnico visual
Megacomponentes: `AgendaScreen` 63 KB, `GradeTempo` 49 KB, `ListaDeItens` 23 KB, `TabelaItens`, `TaskComposer`; 184 linhas >300 caracteres (JSX numa linha só); "Mover para pasta" duplicado em `NoteOrganizer` e `TaskComposer`; sem ESLint/Prettier configurados; `MenuMultiplo.tsx` detectado como binário (provável NUL/encoding — verificar); rotas duplicadas de equipes/perfil; ids de módulo `equipe`/`equipes` divergentes; 11 testes, todos Agenda/Hoje.

---

## 5. Matriz de priorização (Score = Impacto×Confiança/Esforço)
| ID | Problema | Cat. | I | C | E | Score | Prioridade |
|---|---|---|---|---|---|---|---|
| UX-08 | Duplicar tarefa → rota errada | UX | 3 | 5 | 1 | 15.0 | P0 |
| UX-04 | "Carregando…" infinito (5 telas) | UX | 4 | 5 | 1 | 20.0 | P0 |
| UX-09 | Servidor sem rollback | UX | 4 | 5 | 1 | 20.0 | P0 |
| UX-01 | Sync/Privacidade falsos | UX | 5 | 5 | 1 | 25.0 | P0 |
| A11Y-1 | `:focus-visible` global | A11y | 4 | 5 | 1 | 20.0 | P0 |
| UI-1 | Tokens de contraste (muted, borda, light) | A11y | 4 | 5 | 1 | 20.0 | P0 |
| UI-2 | `surface-raised` inexistente | UI | 2 | 5 | 1 | 10.0 | P0 |
| MC-1 | Microcopy técnico/genérico | UX | 3 | 5 | 1 | 15.0 | P0 |
| UX-06 | Rede ≠ "sumiu"/"bloqueado" | UX | 3 | 5 | 1 | 15.0 | P0 |
| UX-02 | Badge eventos efêmeros | UX | 4 | 5 | 1 | 20.0 | P0 |
| GAP-1 | Frase de reset do Cofre divergente | Back↔Front | 3 | 5 | 1 | 15.0 | P0 |
| SEC-1 | Autorização de equipes no backend | Risco | 5 | 4 | 3 | 6.7 | P1 |
| UX-03 | Autosave fantasma | UX | 4 | 4 | 2 | 8.0 | P1 |
| A11Y-2 | Drawer/dialogs modais reais | A11y | 4 | 5 | 2 | 10.0 | P1 |
| A11Y-3 | BottomNav 44 px + rótulos | A11y | 3 | 5 | 1 | 15.0 | P1 |
| UX-10 | Recuperar senha | UX/Gap | 4 | 5 | 2 | 10.0 | P1 |
| UX-07 | Desfazer (toast) | UX | 4 | 4 | 2 | 8.0 | P1 |
| PERF-1 | `React.lazy` + pdfjs dinâmico | Perf | 3 | 4 | 1 | 12.0 | P1 |
| DS-1 | Primitivos Button/Input/Modal/Menu | Débito | 4 | 4 | 4 | 4.0 | P1/P2 |
| UX-05 | Offline + fila | UX | 5 | 3 | 4 | 3.75 | P2 |
| UX-12 | Reforma da IA (Hoje, ordem, Voltar) | UX | 3 | 3 | 3 | 3.0 | P2 |
| GAP-2 | Membros (papéis/remover), backlinks | Gap | 3 | 4 | 2 | 6.0 | P1 |
| DS-2 | Storybook + jest-axe + testes | Débito | 3 | 4 | 3 | 4.0 | P2 |
| PERF-2 | Virtualização de listas | Perf | 3 | 2 | 3 | 2.0 | P2 |

---

## 6. Roadmap em 3 horizontes
**H1 — 1–2 semanas (alto impacto / baixo esforço):** contraste e tokens, `:focus-visible`, `surface-raised`, "Carregando" infinito, rota do Duplicar, rollback do servidor, esconder/rotular telas mock, badge de evento efêmero, microcopy (lista §4.2), frase do reset, `.gitignore` dos `.apk`, remover órfãos (`PlaceholderScreen`, `FoldersScreen`) ou religar Onboarding.
**H2 — 1–2 meses:** primitivos `Button/Input/Dialog/Menu/Toast`; Drawer e diálogos acessíveis; BottomNav; recuperar senha; desfazer; autosave sem fantasmas; autorização de equipes + testes; lazy-load + chunks; `prefers-color-scheme`; UI de membros/backlinks; erros por `error.code` com mapa de campos legíveis; Storybook + jest-axe.
**H3 — trimestre:** offline real (fila + indicador), sync de verdade, persistência de eventos da Agenda, recorrências/pendências/backup do Cofre, notificações com produtores, revisão da IA (Hoje/Busca, atalhos documentados, unificar Espaço/Equipe), virtualização, identidade visual/escala tipográfica, criação do usuário nº 2 (convite).

---

## 7. Quick wins prontos (código)

**a) Contraste e foco (`tokens.css` / `global.css`)** — valores sugeridos, *validar com ferramenta de contraste antes de aplicar*:
```css
/* dark: subir muted p/ ≥4.5:1 também sobre surface-3 */
:root, [data-theme="dark"] { --ecos-text-muted: #9aa8bd; /* ajustar até ≥4.5 em surface-3 */ }
html[data-theme="light"]   { --ecos-text-muted: #55627a; }
:where(button,[role="button"],a,input,select,textarea,summary,[tabindex]):focus-visible {
  outline: 2px solid var(--ecos-cyan); outline-offset: 2px;
}
.ecos-input:focus { outline: none; }
.ecos-input:focus-visible { outline: 2px solid var(--ecos-cyan); outline-offset: 1px; }
@media (prefers-reduced-motion: reduce) {
  .ecos-fade-in, .ecos-item-entra, .ecos-item-sai { animation: none !important; }
}
```
**b) `tailwind.config.cjs`:** definir `surface.raised` = surface-2 (ou trocar a classe nos 2 arquivos).
**c) Rota:** `TaskDetailScreen.tsx:132` → `navigate(\`/tarefa/${criada.id}\`)`.
**d) Estado de erro reutilizável:** componente `ErroCarregar({onRetry, offline})`; nas 5 telas usar `erro !== null ? <ErroCarregar/> : lista === null ? <Skeleton/> : …`.
**e) Servidor:** em `ServerConfigScreen` guardar `anterior`, gravar, testar, e em falha `definirServidorBaseUrl(anterior)`.
**f) Notas:** `catch(e => e instanceof ApiError && e.status===404 ? setNaoEncontrada(true) : setErro(...))`.
**g) Alvos:** `BottomNav` item → `min-h-11 min-w-11 py-2` + `<span class="text-[11px]">` com rótulo; `<nav aria-label="Principal">`.
**h) Cofre/Sync/Privacidade:** remover "Tudo sincronizado…", trocar por "Sincronização entre dispositivos: em breve"; `disabled` + selo "Em breve" nos toggles/botões inertes; alinhar frase do reset com `"APAGAR TUDO"`.
**i) Copy:** trocar "O ecos-app está rodando?" por "Não consegui falar com o servidor. Confira o endereço e sua conexão."; remover "(seção 5.1)"/"Rust"; corrigir aspas em `TaskComposer:166`; padronizar "Mídia", "Espaço", "Excluir", "…".
**j) Repositório:** `*.apk` no `.gitignore`.

---

## 8. Riscos, suposições, limitações
- Sem execução: contrastes calculados de tokens, não de pixels reais; nada medido de CWV.
- Alguns "sem UI" vêm de grep de chamadas (pode haver uso indireto); rotas `pastas/busca/feed/avatar/media` e vault `recorrencias/pendencias/backup` lidas por struct, não handler completo.
- Achados de autorização (SEC-1) são **hipótese forte a confirmar com teste** (usuário B acessando `equipe:<id>` de A).
- Nenhum dado de usuários/métricas fornecido; nada inventado.
- Design System/Figma não fornecido: recomendações de tokens são propostas.

## 9. Próximos passos
1. Medir: Lighthouse/CWV no build Tauri e Android, tamanho do bundle por módulo, INP na Agenda, taxa de notas vazias/fantasma criadas.
2. Testar com usuários (5 pessoas): captura rápida no toque, criar tarefa com data, encontrar "Hoje", entender "Espaço/Equipe", fluxo de perda de senha, entender o Cofre bloqueado.
3. Teste com NVDA/TalkBack e navegação só por teclado (Drawer, Agenda, abas).
4. Teste de autorização multiusuário no backend.
5. Ofertas: refazer a auditoria de uma tela específica, gerar o código refatorado dos quick wins (§7), criar a base do Design System (`Button/Input/Dialog/Menu/Toast` + tokens) ou montar o roteiro de testes com usuários.

---

## Verificação (após aprovar)
Gravar em `ecos-app/docs/AUDITORIA-UIUX.md` (sem tocar em código). Se depois você pedir os quick wins: `npm test` e `npm run build` em `app/client`, e checagem visual no `preview_start` (contraste, foco, BottomNav, telas de erro).
