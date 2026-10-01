# Cofre: migração financeira do Nexus

## Contexto e decisão

Uso informado: 2–3 pessoas, aproximadamente 299 movimentações mensais por pessoa e até 30 mil registros ao longo dos anos. Mantemos React/TypeScript, Rust/Axum e o banco isolado por usuário. Produção continua usando a imagem SQLCipher existente. Não há novos serviços, dependências ou custos de infraestrutura.

Alternativas avaliadas: copiar agregações do Nexus para o navegador (simples, mas dependente de carregar todo o histórico); adaptar o cliente e agregar no vault (escolhida); criar serviço analítico independente (custo operacional injustificado).

O Cofre é um ambiente de navegação próprio: substitui o shell do Ecos, possui Painel, Lançamentos, Fluxo financeiro, CSV e Configurações. “Voltar ao Ecos” retorna ao aplicativo principal. A identidade continua vindo da autenticação do Ecos; o desbloqueio financeiro continua independente.

Referências funcionais: `Nexus/apps/desktop/src/pages/Dashboard.tsx`, `Workflow.tsx`, `lib/aggregate.ts`, `lib/recurring.ts` e `packages/core/src/csv-import.ts`. Não há acesso direto do navegador ao banco Nexus. Esta entrega porta os recursos; não copia os dados pessoais existentes automaticamente.

## Contratos financeiros

- Valores persistidos em centavos inteiros. Interface e CSV em BRL.
- Saldo: entradas menos saídas de todo o histórico, incluindo lançamentos sem conta.
- Receitas/despesas e rankings: todos os lançamentos do período inclusivo, independentemente da conciliação. Extrato paginado não limita os totais.
- Taxa de economia: `(receitas - despesas) / receitas * 100`; sem receitas, não há taxa.
- Gráfico sem previsão: lançamentos conciliados. Com previsão: acrescenta os não conciliados e as ocorrências ainda não materializadas. Essa distinção segue o painel Nexus e está explícita na interface.
- `status` (pendente/efetivada) e `conciliada` são campos distintos. “Concluir lançamento” no fluxo efetiva e concilia atomicamente.
- Agrupamento diário até 45 dias e mensal acima disso. Períodos de até 3.660 dias.
- Drill-down de categoria/forma de pagamento inclui o grupo sem classificação. Intervalos mensais são limitados ao período selecionado.

## Importação, exportação e lotes

O parser aceita BOM UTF-8, aspas escapadas, campos multilinha, `;`, vírgula ou tabulação, com mapeamento explícito de colunas. Datas: `dd/mm/aaaa` ou ISO; valores: `1.234,56`, `R$ 1.234,56`. Tipo define o sinal; o valor é absoluto. Datas inexistentes, centavos excedentes, forma de pagamento desconhecida e colunas divergentes são recusados.

Prévia local e dry-run no servidor não gravam entidades. Importação definitiva revalida tudo dentro da transação. Se qualquer linha for inválida, nenhuma linha é gravada. Duplicatas são reportadas e ignoradas tanto dentro do arquivo quanto contra o banco: data, tipo, centavos, descrição sem espaços externos/ignorando caixa e conta. Essa regra pode identificar dois pagamentos legítimos iguais como duplicados; eles devem ser cadastrados manualmente ou diferenciados na descrição. A execução final pode encontrar mais duplicatas que a prévia se houver uma importação concorrente.

Categorias, beneficiários e contas citados por nome são encontrados ou criados apenas ao confirmar. Limite de 10 mil linhas por requisição; a interface limita arquivos a 1,5 MB. Dividir arquivos maiores preserva a deduplicação. O relatório identifica registros por número (cabeçalho = 1; campos multilinha continuam sendo um único registro).

Exportação inclui todos os lançamentos do período, nomes das entidades, conciliação e status. Produz UTF-8 com BOM, separador `;`, CRLF e aspas. Células iniciadas por operadores de fórmula recebem apóstrofo para serem tratadas como texto por planilhas. O download é criado em memória e a URL temporária é revogada.

Lotes de até mil IDs são atômicos. IDs ausentes causam relatório de erro e rollback total. Progresso indeterminado durante a requisição; ao concluir, mostra quantidade aplicada e erros. Não há fila offline para operações financeiras.

## Recorrências e consistência

A migration `0002_financeiro.sql` acrescenta conciliação, data original da ocorrência e registros de idempotência. Não remove lançamentos legados nem tenta adivinhar sua conciliação: começam não conciliados.

Uma ocorrência é identificada por `(recorrencia_id, data_ocorrencia)`, mesmo se o lançamento mudar de dia. Conversões de pendência preservam uma relação com a transação criada. Leitura, criação e registro dessa relação acontecem na mesma transação. Repetições de requisição retornam a mesma transação.

O job e o fluxo usam a mesma expansão de datas. Datas mensais são derivadas da âncora original, preservando dia 31 após fevereiro. Exclusões e ocorrências já processadas são ignoradas. O contador legado é preservado como limite de ocorrências antigas, inclusive quando lançamentos antigos já foram excluídos. Registros de idempotência sobrevivem à exclusão do lançamento para impedir recriação pelo job; reset remove tudo.

No cliente, arraste ou seleção + data produzem atualização otimista. Em erro, o estado visual anterior é restaurado e a mensagem orienta atualizar/repetir. Uma resposta perdida após commit não equivale a rollback no servidor: por isso a idempotência é necessária.

## Privacidade, acessibilidade e operação

Todas as consultas permanecem no escopo de usuário do vault. Respostas financeiras recebem `Cache-Control: no-store, private` no vault e no proxy; fetch também usa `no-store`. O cache offline existente exclui rotas `/vault/`.

Bloquear desmonta imediatamente a interface financeira. Uma geração de sessão invalida respostas atrasadas, inclusive exportações. Abas do mesmo navegador propagam bloqueio via BroadcastChannel, sem dados financeiros. Verificação no foco e a cada 30 segundos detecta bloqueio externo; resposta `VAULT_LOCKED` fecha a interface imediatamente. Se o pedido de bloqueio falhar, a tela continua oculta e informa que o bloqueio remoto não foi confirmado. Somente a preferência de cor é persistida localmente.

Gráficos oferecem valores textuais, tabela navegável por teclado e seleção por ponteiro/toque. O fluxo oferece agendamento por formulário além do drag-and-drop. Layouts usam quebra de colunas e rolagem em superfícies largas. A validação visual e em dispositivo fica com o usuário, conforme AGENTS.md.

Logs estruturados registram status/duração das requisições e conclusão de operações, sem valores, descrições ou conteúdo CSV. `/health` permanece liveness interno. Não foi adicionado coletor de métricas ou serviço de tracing para esta escala.

## Executar e publicar

Validação local, na raiz do repositório:

```powershell
cargo test --workspace --no-default-features
cd app/client
npm test -- --config vitest.config.ts
npm run build
```

Testes locais sem `real-sqlcipher` validam a lógica com SQLite e dados sintéticos; não validam criptografia. Para produção, usar o Dockerfile existente que habilita SQLCipher.

Antes do deploy, parar gravações e preservar snapshot dos volumes `ecos-vault` e `ecos-vault-backups`, incluindo metadados de ativação e todos os arquivos por usuário. A migration aplica no próximo desbloqueio. Construir e subir cliente/servidor/vault juntos, com o Cofre habilitado:

```sh
docker compose --profile default --profile vault up -d --build
```

Rollback: parar serviços, restaurar os volumes do snapshot anterior e as imagens anteriores compatíveis, depois reiniciar. Não executar uma migration reversa sobre lançamentos novos. Dados criados após o snapshot devem ser exportados e reconciliados antes da restauração.

Esta entrega justifica uma release de funcionalidade (minor). Como o projeto está em 0.x, combinar a numeração antes de alterar versões. Nenhuma versão, tag, publicação ou deploy é realizado automaticamente.

## Verificação realizada

- Suíte completa do cliente: 568 testes aprovados antes dos três casos finais; os 10 testes específicos finais (CSV, gráfico, rollback e bloqueio de respostas HTTP) também passaram.
- Workspace Rust: 86 testes do servidor, 50 do core e 11 do vault aprovados; a rodada final do vault inclui 12 testes, com proteção de ocorrências legadas.
- Fixture de 30.000 registros: KPIs e séries conciliados, consulta do painel em aproximadamente 81 ms no ambiente local de teste (SQLite, sem representar SLA de produção).
- Build de produção do cliente aprovado; Vite mantém aviso de bundle acima de 500 kB.
- Imagem Linux/SQLCipher e validação em aparelho físico não foram executadas nesta sessão.


## Revisão visual de 30/09/2026

Reutilizados do Nexus: KpiCard, PeriodPicker, ComposedAreaChart, DonutChart, HorizontalBarChart e utilitários de períodos. Os componentes foram adaptados aos tokens do Ecos, à API do vault e ao bloqueio da sessão. A grade mensal usa o mesmo gerador de calendário do Nexus; no celular o dia selecionado abre a lista completa abaixo da grade. Semana/quinzena usam colunas roláveis e timeline cobre 45 dias.

O Cofre tem cabeçalho próprio, navegação lateral em desktop e inferior no celular. Extrato, CSV e configurações usam controles e cartões responsivos. O seletor de período mantém foco no diálogo e retorna ao botão ao fechar. O gráfico aceita toque para consultar valores, toque duplo/Enter para abrir lançamentos e setas para navegar.

QA visual no navegador: 360, 390 e 1440 pixels. Painel, extrato, fluxo, CSV e configurações inspecionados; previsão, cores, seletor de período, erro 404 e bloqueio exercitados. A fixture isolada `app/client/qa/cofre.html` usa somente dados sintéticos e não integra a entrada do build de produção. Capturas locais ficam em `qa-artifacts/` e não são artefatos de release.

A inspeção do contêiner em execução confirmou um binário antigo do vault sem `/vault/painel`. Por isso, mudanças no frontend sozinhas não resolvem o 404 da instalação atual. A atualização coordenada das imagens do app/vault e a migration continuam pendentes; nenhuma atualização de contêiner foi feita nesta revisão.


## Deploy autorizado em 30/09/2026

Atualização aplicada aos serviços `ecos-app` e `ecos-vault-db`, preservando os volumes existentes. Ambas as imagens de produção compilaram em Linux; vault com `real-sqlcipher`. Snapshot consistente realizado com os serviços parados e validado por leitura dos arquivos tar e hashes SHA-256.

Backup local: `../deployment-backups/cofre-20260930-135416/` (`ecos-app-data.tar`, `ecos-vault-data.tar`, `checksums.json`, `deployment.json`). Inclui notas, índice e diretórios de backup do Ecos, além dos dados/metadados e backups do Cofre. Imagens anteriores preservadas como `ecos/app:rollback-20260930-135416` e `ecos/vault-db:rollback-20260930-135416`.

Pós-deploy: os dois contêineres em execução; `/health/ready` retorna `ok`, índice acessível e vault conectado; frontend publicado contém o novo bundle `index-zyeLIGHk.js`. A rota interna `/vault/painel` retorna 401 sem autenticação, confirmando que existe e está protegida, em vez do 404 anterior. Nenhum payload financeiro foi lido. A migration por usuário é aplicada no próximo desbloqueio; a verificação dos dados autenticados depende desse desbloqueio pelo usuário.

O contexto Docker passou a excluir saídas de build Android, logs e fixtures de QA para evitar transferência de artefatos locais nos próximos builds. Nenhuma versão, tag ou release foi publicada.
