# Handoff (front-end): formas de pagamento cadastráveis

**Estado:** backend pronto e testado (`cargo test -p ecos-vault-db`, 73 testes, incluindo a migração sobre um banco com dados e anexo). Nada foi alterado no cliente. Este documento diz o que a API entrega e o que o front precisa fazer.

## Contexto

Até aqui as formas de pagamento eram uma lista fixa de sete (`pix, pix_automatico, ted, cartao, dinheiro, boleto, outro`), repetida no banco, no servidor e em cinco telas. Agora ela é uma tabela por cofre (cada pessoa e cada equipe têm a sua), no mesmo modelo de Categorias: a pessoa cria, renomeia, desativa e apaga.

**Decisão de produto que afeta a tela:** Categorias fica em página própria. Bancos, Contas, Sacados e Formas de pagamento vão para **uma tela única na sidebar** (proposta de nome: **Cadastros**, a definir com o time). Bancos e Contas já têm cadastro dinâmico; esta entrega só acrescenta a quarta seção.

## O que NÃO muda

- `transacao.forma_pagamento` e `transacao_recorrente.forma_pagamento` continuam sendo **string**. Agora essa string é o `codigo` da forma (`"pix"`, `"cartao_de_debito"`...). Os lançamentos existentes não foram tocados.
- Os payloads de transações, recorrências e importação continuam iguais. Só mudou a validação: o código precisa existir no cadastro, senão `422` (`PAYMENT_METHOD_INVALID`).
- Filtros por forma (`?forma_pagamento=` e `?sem_pagamento=true` em `/vault/transacoes`) funcionam com qualquer código.

## Contrato da API (`/vault/formas-pagamento`)

Mesmo prefixo e autenticação das outras rotas do Cofre. Todas exigem o Cofre destrancado.

### `GET /vault/formas-pagamento`
Lista ordenada por `ordem`, depois nome. Inclui as **inativas** (a tela de gerenciar mostra todas; os seletores filtram `ativa`).
```json
[{ "codigo": "pix", "nome": "Pix", "icone": null, "cor": null, "padrao": true, "ativa": true,
   "ordem": 1, "criado_por": null, "usos": 12 }]
```
- `padrao: true` = de fábrica (as sete). `usos` = lançamentos + recorrências que usam a forma (serve para mostrar "usada em 12 itens" sem outra chamada).
- `icone` é nome de ícone Lucide (PascalCase), igual às categorias. `cor` é hex. Ambos opcionais.

### `POST /vault/formas-pagamento`
Corpo: `{ "nome": "Cartão de Débito", "icone"?: "CreditCard", "cor"?: "#7DD3FC" }` → `{ "codigo": "cartao_de_debito" }`.
- O `codigo` é gerado no servidor (sem acento, minúsculas, `_`), com sufixo `_2`, `_3` se colidir. **O front nunca monta nem edita o código.**
- `nome`: 1 a 40 caracteres. Repetido (sem diferenciar maiúsculas, inclusive das de fábrica) → `409`. Vazio ou longo → `422`.

### `PATCH /vault/formas-pagamento/:codigo`
Corpo parcial; campo omitido não muda: `{ "nome"?, "icone"?: string | null, "cor"?: string | null, "ativa"?: boolean }`.
- `icone: null` e `cor: null` **limpam** o campo.
- Renomear não mexe nos lançamentos (eles guardam o código). Nome de outra forma → `409`. Código inexistente → `404`.
- Vale para as de fábrica também (renomear, trocar ícone, desativar).

### `GET /vault/formas-pagamento/:codigo/uso`
```json
{ "transacoes": 3, "recorrencias": 1, "amostra": [{ "id": "…", "data": "2026-09-30", "descricao": "…", "tipo": "saida", "valor_centavos": 1000 }] }
```
`amostra` = até 100 lançamentos mais recentes. Use para o diálogo de exclusão. `404` se não existe.

### `DELETE /vault/formas-pagamento/:codigo`
Corpo opcional: `{ "mover_para"?: "<codigo>", "sem_forma"?: true }`.
- **Sem uso:** apaga direto (corpo pode ser vazio).
- **Com uso:** é obrigatório escolher um destino, senão `409` com a mensagem pronta ("…usada por N itens. Escolha para onde movê-los…"). `mover_para` leva lançamentos **e recorrências** para a outra forma; `sem_forma: true` deixa todos sem forma de pagamento. Mover e apagar é atômico.
- `mover_para` + `sem_forma` juntos, ou `mover_para` igual ao próprio código → `422`. Destino inexistente → `404`.
- **Formas de fábrica não se apagam** → `409` ("…Desative a que você não usa."). Na tela: esconda o botão Excluir quando `padrao` e ofereça Desativar.

Erros seguem o formato padrão do Cofre (`{ code, message }`); as mensagens já vêm em português e podem ser mostradas como estão.

## Regras de comportamento que o front deve respeitar

1. **Inativa não some dos lançamentos antigos.** Desativar só tira a forma dos **seletores** (novo lançamento, recorrência, filtros de criação). Em um lançamento que já usa uma forma inativa, o seletor deve continuar mostrando o valor atual (e permitir salvar sem trocá-lo). O servidor aceita código inativo.
2. **Exibição sempre pelo cadastro.** Mostre `nome` (e `icone`/`cor`) buscando o código na lista de `GET /vault/formas-pagamento`, não em mapa fixo. Se o código não for achado (não deveria acontecer), mostre o próprio código em vez de quebrar.
3. **Sem forma** continua existindo: `forma_pagamento: null`. "Sem forma de pagamento" é item à parte nos seletores, não uma forma.
4. **Equipe:** cada cofre de equipe tem o seu cadastro; ele já nasce com as sete de fábrica.
5. **Painel, exportações e CSV** devolvem o **código**. O CSV de exportação e o painel (`/vault/painel` agrupa por `forma_pagamento`) continuam com código. Traduza para nome no cliente. A importação CSV valida contra o cadastro (o servidor recusa código desconhecido; decida se a tela traduz "Cartão de Débito" → código antes de enviar).
6. **Busca** (`/vault/busca`) agora encontra pelo **nome** cadastrado da forma, sem mudança no cliente.

## O que mudar no cliente

Uma fonte única, em vez de sete cópias do mesmo mapa:

| Hoje | Fazer |
|---|---|
| `FORMAS_PAGAMENTO` e o tipo `FormaPagamento` em `src/lib/api.ts` (≈ linha 1046) | Trocar a união literal por `string`. Acrescentar tipo `FormaPagamentoApi` (campos do GET) e `vault.formasPagamento.{listar, criar, atualizar, uso, excluir}`. |
| `LABEL_FORMA` em `screens/Create/TransactionForm.tsx` | Opções do seletor vêm da lista (só `ativa`, mais a atual do lançamento). |
| `PAGAMENTOS` em `VaultTransactions.tsx`, `FORMAS` em `VaultAccounts.tsx`, `pagamentos` em `VaultDashboard.tsx`, `ROTULO_FORMA` em `recorrencias/RecorrenciaModal.tsx` | Remover os mapas; usar um hook/contexto compartilhado (sugestão: `useFormasPagamento()` que carrega uma vez, expõe `porCodigo`, `ativas` e `recarregar`, e recarrega após criar/editar/apagar). |
| Validação de `forma_pagamento` em `csv.ts` / `VaultCsv*.tsx` | Conferir contra a lista carregada. |
| Filtro "Pagamento" na lista de transações e no painel | Opções vêm do mesmo hook (incluir inativas que tenham `usos > 0`, para o filtro achar lançamentos antigos). |

Atenção: o servidor ainda usa os códigos de fábrica no OCR de comprovantes (`pix`, `boleto`, `cartao`), por isso eles não são apagáveis. O front não deve depender disso, mas não precisa tratar o caso de uma forma de fábrica sumir.

## Tela (dentro de "Cadastros")

Seção **Formas de pagamento**, no padrão visual de Categorias:
- Lista com ícone, nome, selo "De fábrica" quando `padrao`, contagem de `usos`, interruptor Ativa.
- Criar/editar em modal (nome, ícone via o `IconPicker` já existente, cor via o seletor de cores já usado em categorias).
- Excluir: se `usos > 0`, abrir o diálogo de destino (outra forma **ou** "Deixar sem forma de pagamento"), igual ao de categorias, mostrando a `amostra`. Chamar `DELETE` só depois da escolha.
- Estado vazio não existe (sempre há as de fábrica); mensagem de erro `409` de nome repetido deve aparecer no próprio campo.
- Ordenação manual **não está implementada** no backend (a lista vem por `ordem`, fixa na criação). Se o design quiser arrastar para reordenar, avisar: é um endpoint a mais.

## Testes sugeridos no cliente

- Seletor de lançamento: mostra só ativas + a atual; criar forma nova e usá-la sem recarregar a página.
- Desativar uma forma em uso não altera a exibição do lançamento antigo.
- Exclusão com uso exige destino; com `sem_forma` o lançamento passa a "Sem forma".
- Forma de fábrica não mostra Excluir.

## Notas de infraestrutura (para quem faz o deploy)

- Migração `0010_formas_pagamento` roda sozinha ao destrancar cada cofre. Ela remove, das tabelas `transacao` e `transacao_recorrente`, a restrição `CHECK` com a lista fixa, editando o texto do schema (`writable_schema`), sem recriar tabelas, para não arriscar os anexos. Foi validada com SQLite puro e com o teste de integridade; **ainda não foi exercitada na build `real-sqlcipher`**, então vale abrir uma cópia de um cofre real nessa build antes de liberar.
- Não há rollback automático. Antes de liberar, faça o backup normal do cofre.
