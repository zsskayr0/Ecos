# Changelog

## Não lançado

Sem mudanças pendentes.

## 0.2.0 — 2026-09-19

APK de teste ARM64 debug (assinatura de debug, não um pacote de produção para loja). Android versionCode: 1003 (último distribuído: 1001). Inclui as correções da 0.1.1, que não chegou a ser publicada. **O servidor precisa ser reconstruído** (migrações 0005 a 0007 no índice local).

### Melhorias

- A edição de tarefas no desktop agora salva cada alteração em cache local e a sincroniza automaticamente com o servidor a cada 10 segundos e ao fechar a aba ou janela.
- Ações manuais de editar/salvar foram substituídas por `Concluir tarefa` e uma ação de apagar compacta, com estados de destaque verde e vermelho ao passar o mouse.
- O título da tarefa ganhou um campo mais compacto, sem rótulo redundante; a prioridade foi movida para as ações do desktop e passou a usar bandeiras coloridas.
- Tarefas agora registram tempo planejado e realizado; o histórico de tempo fica na lateral, junto ao planejamento, organização e subtarefas.
- Novas notas e tarefas passam a criar o item e sincronizar cada alteração automaticamente após uma pausa curta, com rascunho local como contingência antes da primeira criação.
- Listas, tabela e grade de notas e tarefas aceitam seleção múltipla: Ctrl/Cmd alterna itens e Shift seleciona um intervalo.
- A seleção múltipla ganhou barra contextual para mover itens entre pastas, ajustar a prioridade e concluir tarefas em lote.
- Cada item agora exibe uma caixa de seleção explícita e independente do ícone de status, evitando confusão com seleção de texto ou com o estado concluído/pendente.
- Operações em lote passaram a atualizar itens em sequência, evitando concorrência com a reindexação do servidor; falhas agora aparecem diretamente na barra de ações.

- Interface desktop em painéis: barra lateral de módulos, colunas redimensionáveis com abas por painel (arrastar, mover, dividir e fixar), paleta de comandos (Ctrl+K) e atalhos (Ctrl+W, Ctrl+Tab, Ctrl+\\, Ctrl+1..9). O layout é lembrado entre sessões e fechar abas e janelas tem animação. Abaixo de 1024 px e no Android continua o layout mobile.
- Notas, tarefas e arquivos abrem numa janela flutuante que arrasta, redimensiona e pode ser fixada como aba; Ctrl/Cmd+clique abre direto como aba. A janela de arquivo já abre no tamanho da imagem ou da primeira página do PDF.
- Novas visualizações no desktop, no Feed, em Notas e em Tarefas: Feed (cards), Tabela (colunas ordenáveis e redimensionáveis: status, prioridade, prazo, pasta, equipe, tags, editada, revisada, criada, dono) e Grade de blocos.
- Pastas viraram blocos quadrados (1:1) com botão para ocultar e mostrar, lembrado por módulo.
- Leitor de PDF integrado (pdf.js, sem `<iframe>`, que o servidor e o Tauri bloqueiam) para os arquivos da biblioteca, com zoom, navegação por página e ajuste à largura.
- Editor da descrição com barra de formatação em Markdown (estilo, negrito, itálico, listas, citação, link, emoji, limpar formatação). Nota no desktop com título, pasta e tags de acesso rápido, anexos e salvamento automático; a criação de nota segue o mesmo padrão.
- Notas e tarefas mostram a última edição no formato de feed ("há 3 horas", "15/09 - 12:46", "12/04/2024 - 12:30").
- Tarefa ou nota criada dentro de uma pasta já nasce nela; tarefas que estão em pastas não aparecem mais em "Sem pasta" (o filtro vazio não chegava ao servidor).
- Anexos podem ser colados com Ctrl+V (capturas de tela e arquivos), inseridos no cursor com nome próprio.
- Nova identidade visual: logo vetorizada, ícones do aplicativo e favicon, e nova tela de login com painel de curvas animadas.
- Servidor: migração 0005 guarda `atualizado_em` nas tarefas (criar, editar e concluir); a listagem de tarefas e o Feed passam a devolver pasta, tags e datas. **Exige reconstruir a imagem Docker.** Tarefas antigas usam a data de modificação do arquivo até a próxima edição.

- Filtros simples em Feed, Notas, Tarefas e pastas: Status (Pendentes, Atrasadas, Concluídas), Prioridade, Equipe, Pasta (várias de uma vez, inclusive "Sem pasta") e Ordenar. O filtro ativo ganha a cor da escolha; os menus são do próprio app, com destaque deslizante animado e ícones, e o seletor de estilo do texto do editor usa o mesmo menu.
- O Feed mistura tarefas pendentes (não só as de hoje) com as notas, que pesam mais; tarefas vencidas há mais de 14 dias saem do Feed por um tempo.
- "Ajustar rotina" no perfil (e ao fim do onboarding): sono, trabalho, refeição, deslocamento, horário de produção e tempo livre viram os blocos de rotina que a Agenda usa; a Agenda avisa quem ainda não configurou.
- Um `.md` solto em `ecos-notes/Notas/` (ou arrastado para a aba Notas) é adotado como nota: o servidor completa o front-matter que faltar, sem tocar no corpo.
- Menu lateral do desktop expande e recolhe (Ctrl/Cmd+B), lembrando a escolha. Logo animada no login.
- Agenda: o dia agora respeita o fuso do usuário, o aviso de "a conta não fecha" mostra o total real de produção e as durações aparecem como "1h05".
- Senha não aceita espaços (campo e servidor).
- Organização do repositório: código em `ecos-app/` e notas em `ecos-notes/`, fora do git; `.claude/` deixou de ser versionado.

### Correções

- No navegador a sessão caía a cada 15 minutos porque nada renovava o token; agora ele renova sozinho. Com o servidor reiniciando, o app espera e reconecta em vez de voltar ao login.
- Abrir a criação de tarefa no celular travava com "Algo quebrou" (ordem dos hooks no `CreateFlow`); a descrição da tarefa deixou de sumir junto com os detalhes no mobile.
- Ícone adaptativo do Android não fica mais cortado (fundo em degradê e marca na zona segura).
- Servidor: pastas por espaço de trabalho (migração 0007) e versão de schema conhecida corrigida; nota pode mudar de espaço.

### Verificação

- `npm run build` do cliente concluído com sucesso. O Vite manteve o aviso pré-existente sobre o tamanho do bundle principal.
- `cargo check -p ecos-app` e os testes do `ecos-core` passaram (inclui leitura de tarefas antigas sem `atualizado_em`).
- Interações do desktop (painéis, janelas, tabela, grade, pastas, colagem de anexos, filtros e menus) verificadas em navegador com API simulada; adoção de `.md`, renovação e reconexão de sessão verificadas contra o servidor local. Testes Rust do `ecos-app` e do `ecos-core` passam.
- Limitações: APK com assinatura de debug; persistência do refresh token no Android ainda em memória; arrastar `.md` na aba Notas e o questionário de rotina não foram exercitados com sessão real. Validação visual completa, no app instalado e no celular, fica com o usuário.

## 0.1.1 — 2026-09-18

Versão preparada localmente; publicação no GitHub não autorizada. APK de teste ARM64 debug, não um pacote de produção assinado para loja. Android versionCode: 1001 (anterior: 1000).

### Correções

- Login Android deixa de depender do Credential Manager do Windows. O refresh token fica exclusivamente na memória nativa; encerrar o processo exige novo login.
- Falhas de autenticação nativa distinguem indisponibilidade de rede, erros de autenticação, limite de tentativas e respostas incompatíveis do servidor.
- Renovação de sessão nativa compartilhada entre requisições simultâneas, evitando tentativas concorrentes de rotação do token.
- Inicialização não permanece em carregamento indefinidamente quando o servidor está inacessível.
- Login só conclui após obter o perfil autenticado com sucesso.

### Verificação

- Compilação frontend e APK Android ARM64 debug concluídas.
- Três testes Rust passaram, incluindo sessão Android em memória e contrato HTTP simulado.
- Usuário confirmou que o login funciona no celular e aprovou a preparação da versão. Persistência Android via Keystore ainda não implementada.

### Referência

- Base anterior: commit `90986d9`, versão declarada `0.1.0`. Esse commit não é tratado como release publicada.
