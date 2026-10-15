# Tokens do frontend: alterações em relação à spec

`app/client/src/styles/tokens.css` espelha a seção 1.3 de `ecos-prompt-execucao-frontend.md`
(arquivo não encontrado no repositório nem no workspace em 2026-10-15). As mudanças abaixo
vieram da task "Corrigir tokens de contraste" (commit `632ab04`) e precisam ser refletidas na
spec por quem a mantém. Até lá, `tokens.css` é a fonte de verdade.

Guarda automatizada: `app/client/src/styles/tokens.contraste.test.ts` (texto e acento ≥ 4,5:1;
borda de controle ≥ 3:1) falha se um valor voltar a regredir.

## Tema escuro
| Token | Antes | Agora | Motivo |
|---|---|---|---|
| `--ecos-text-muted` | `#6b6c72` | `#8f9098` | 3,15:1 em surface-3; agora ≥ 5,19:1 |
| `--ecos-error`, `--ecos-esquecimento` | `#ef4444` | `#f25f5f` | 4,38:1 em surface-3; agora ≥ 4,5:1 |
| `--ecos-border-control` (novo) | — | `#767676` | borda de campos ≥ 3:1 (WCAG 1.4.11); `--ecos-border` segue decorativa |
| `--ecos-on-accent` (novo) | — | `#000000` | texto/ícone sobre ciano/violeta (Fab) |

## Tema claro
| Token | Antes | Agora |
|---|---|---|
| `--ecos-text-muted` | `#6d7994` | `#52607c` |
| `--ecos-steel-500` | `#2366aa` | `#1f5c9e` |
| `--ecos-steel-400` | `#3377b8` | `#2563a3` |
| `--ecos-cyan` | `#087eaf` | `#066591` |
| `--ecos-violet` | `#6d4cc6` | `#6544c0` |
| `--ecos-success` | `#15803d` | `#156a2e` |
| `--ecos-warning` | `#b45309` | `#964308` |
| `--ecos-frescor` / `--ecos-interacao` / `--ecos-orfa` / `--ecos-esquecimento` / `--ecos-encrypted` | (valores do escuro) | `#156a2e` / `#066591` / `#7539b8` / `#b91c1c` / `#6544c0` |
| `--ecos-border-control` (novo) | — | `#667894` |
| `--ecos-on-accent` (novo) | — | `#ffffff` |

## Alto contraste
`--ecos-border-control` = `#8a8a8a` (escuro) e `#4a5a75` (claro).

## Pendências conhecidas
- `steel-500` do escuro não foi clareado: é fundo de botão com texto branco (5,3:1).
- No tema claro, `steel-700` (`#d7e5f6`) com `text-white` em ErrorBoundary, FloatingSaveButton e
  ViewModeToggle dá ~1,3:1 (task própria no backlog).
- Cores de equipe (hex livre do usuário) não são cobertas por token.
