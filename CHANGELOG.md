# Changelog

## Não lançado

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
- Cabeçalhos das coleções agora oferecem filtros rápidos por tipo, status e prioridade, com filtros ativos sempre visíveis.

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
- Android: `versionCode` 1002 para o APK de teste desta rodada (versão 0.1.1 mantida; a numeração da release fica para combinar).

### Verificação

- `npm run build` do cliente concluído com sucesso. O Vite manteve o aviso pré-existente sobre o tamanho do bundle principal.
- `cargo check -p ecos-app` e os testes do `ecos-core` passaram (inclui leitura de tarefas antigas sem `atualizado_em`).
- Interações do desktop (painéis, janelas, tabela, grade, pastas, colagem de anexos) verificadas em navegador com API simulada. Validação visual completa, no app instalado e no celular, fica com o usuário.

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
