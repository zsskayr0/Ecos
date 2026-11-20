import { ancoraDe, semAcento } from "./campos-config";

/**
 * Índice da busca das configurações: cada opção, a aba onde ela mora e palavras que a pessoa pode digitar para achá-la.
 * O título é o mesmo da linha na tela (é dele que sai a âncora para onde a busca rola). Ao criar, mover ou renomear uma
 * opção, atualize a entrada aqui.
 */
type Entrada = string | [titulo: string, palavras: string];

const C = "/configuracoes";

const INDICE: Record<string, Entrada[]> = {
  [`${C}/perfil`]: [["Editar perfil", "nome foto avatar senha email sair logout"]],
  [`${C}/rotina`]: [["Rotina", "horário acordar dormir trabalho período dia"]],
  [`${C}/equipes`]: [["Equipes", "criar entrar convite qr código membros time"]],
  [`${C}/conta`]: [["Exportar meus dados", "zip download backup lgpd baixar"], ["Excluir minha conta", "apagar remover deletar encerrar"]],

  [`${C}/aparencia`]: [
    ["Tema", "escuro claro automático dark light modo noturno cor"],
    ["Tamanho da interface", "zoom escala fonte letra texto maior menor"],
    ["Alto contraste", "acessibilidade visibilidade"],
    ["Reduzir movimento", "animação animações transição acessibilidade"],
    ["Aceleração de hardware", "gpu desempenho performance lento travando"],
  ],
  [`${C}/idioma-regiao`]: [
    ["Idioma", "língua português english inglês español espanhol tradução"],
    ["País", "localização região globo"],
    ["Fuso horário", "hora timezone gmt utc localização"],
    ["Formato de data", "dia mês ano relativo"],
    ["Iniciar semana na segunda-feira", "domingo primeiro dia calendário"],
  ],
  [`${C}/notificacoes`]: [
    ["Resumo do dia", "resumo diário aviso tarefas hoje atrasadas"],
    "Horário do resumo",
    ["Avisos do sistema", "permissão permitir push navegador"],
    ["Não incomodar", "horário silencioso silêncio mudo noite"],
    ["Começa às", "silêncio início"],
    ["Termina às", "silêncio fim"],
  ],
  [`${C}/atalhos`]: [["Atalhos de teclado", "teclas ctrl paleta de comandos fechar aba dividir painel keyboard shortcut"]],

  [`${C}/feed`]: [
    ["Ocultar do Feed", "esconder pastas tags notas tarefas não mostrar feed personalizar"],
  ],

  [`${C}/tarefas`]: [
    ["Visualização padrão", "tabela grade kanban matriz feed lista agrupada tarefas"],
    ["Mostrar concluídas ao abrir", "feitas finalizadas pendentes"],
    ["Abrir tarefas maximizadas", "focus tela cheia"],
    ["Abrir tarefas em edição", "editar visualização leitura"],
    ["Prioridade padrão", "nova tarefa baixa média alta"],
    ["Duração padrão", "nova tarefa tempo estimado minutos"],
    ["Data padrão", "nova tarefa hoje amanhã prazo"],
    ["Horário padrão", "nova tarefa hora agenda"],
    ["Pasta", "nova tarefa onde guardar pasta fixa atual"],
    ["Tags padrão", "nova tarefa etiquetas hierarquia manual"],
    ["Criar maximizada", "nova tarefa focus"],
    ["Barra lateral aberta na criação", "nova tarefa painel"],
  ],
  [`${C}/notas`]: [
    ["Abrir notas maximizadas", "focus tela cheia"],
    ["Abrir notas em edição", "editar visualização leitura"],
    ["Pasta", "nova nota onde guardar pasta fixa atual"],
    ["Tags padrão", "nova nota etiquetas hierarquia manual"],
    ["Criar maximizada", "nova nota focus"],
  ],
  [`${C}/editor`]: [
    ["Enter cria", "captura rápida feed nota tarefa"],
    ["Painel lateral do Focus recolhido", "modo focus barra lateral opções"],
    ["Verificação ortográfica", "corretor erros ortografia sublinhado"],
    ["Idioma do corretor", "ortografia língua"],
    ["Formato para links novos", "links internos caminho relativo completo"],
    ["Usar wikilinks", "links internos markdown colchetes"],
    ["Atualizar links internos", "renomear mover"],
    ["Reconhecer figuras", "escrita à mão caneta tinta desenho formas círculo retângulo"],
    ["Tempo de espera", "escrita à mão caneta figura"],
  ],
  [`${C}/calendario`]: [
    ["Mostrar prazos no calendário", "agenda deadline vencimento"],
    ["Encaixe inicial", "agenda arrastar blocos minutos snap"],
    ["Integrações de calendário", "google calendar outlook ical caldav sincronizar conectar eventos"],
  ],
  [`${C}/grafico`]: [
    ["Itens sem conexão", "gráfico filtros órfãos"],
    ["Rótulos", "gráfico títulos nós"], ["Tamanho do texto", "gráfico rótulos"], ["Tamanho dos nós", "gráfico"], ["Espessura das linhas", "gráfico ligações"],
    ["Setas nos links", "gráfico direção"], ["Órbitas", "gráfico constelações anéis"], ["Nebulosas", "gráfico"], ["Legenda", "gráfico"],
    ["Esmaecer tarefas concluídas", "gráfico"], ["Dica segue o mouse", "gráfico tooltip"],
    ["Repulsão", "gráfico forças"], ["Distância dos links", "gráfico forças"], ["Atração ao centro", "gráfico forças gravidade"],
    ["Movimento contínuo", "gráfico animação"], ["Intensidade do movimento", "gráfico animação"], ["Velocidade das animações", "gráfico"],
    ["Mostrar no modo Focus", "mini gráfico painel"], ["Alcance", "mini gráfico saltos"], ["Altura", "mini gráfico"], ["Incluir tags", "mini gráfico"],
  ],

  [`${C}/pastas-arquivos`]: [
    ["Mostrar pastas ao abrir", "notas tarefas ocultas"],
    ["Estilo das pastas", "grade compacta lista menor"],
    ["Ordem das pastas", "ordenar nome mais usadas itens"],
    ["Modo explorador", "árvore de arquivos menu lateral"],
    ["Ícones de tarefa por prioridade", "explorador cores"],
    ["Marca dos arquivos na árvore", "explorador extensão selo pdf"],
    ["Ícones por tipo de arquivo", "explorador extensão"],
    ["Sugestões na barra de endereço", "arquivos caminho autocompletar"],
    ["Confirmar antes de excluir", "lixeira apagar exclusão"],
    ["Itens excluídos", "lixeira destino apagar permanentemente"],
    ["Anexos ao excluir", "lixeira arquivos"],
  ],
  [`${C}/organizacao`]: [["Pastas", "criar nova pasta subpasta renomear mover organizar espaço"], ["Tags", "etiquetas renomear mesclar excluir catálogo"]],
  [`${C}/pastas-trancadas`]: [["Senha-mestra", "pasta trancada cadeado senha segredo diário privado"], ["Trancar sozinha após", "tempo inatividade minutos"], ["Mostrar tarefas de pastas trancadas", "tarefa privada agenda hoje"]],
  [`${C}/icones`]: [["Ícones personalizados", "imagem logo png enviar upload pasta"]],

  [`${C}/cofre/seguranca`]: [["Bloquear agora", "cofre senha"], ["Bloquear por inatividade", "cofre tempo automático"]],
  [`${C}/privacidade`]: [["Biometria obrigatória", "cofre digital"], ["Ocultar valores no Feed", "cofre dinheiro esconder privacidade"], ["Resetar Cofre", "apagar tudo zona de risco redefinir limpar"]],
  [`${C}/cofre/valores`]: [["Moeda", "cofre símbolo real dólar euro"], ["Exibição e valores", "cofre formato números casas decimais"]],
  [`${C}/cofre/csv`]: [["Backup & CSV", "cofre exportar importar planilha restaurar"]],
  [`${C}/cofre/github`]: [["GitHub", "cofre repositório código"]],
  [`${C}/cofre/ajuda`]: [["Ajuda & Suporte", "cofre dúvidas"]],

  [`${C}/servidor`]: [
    ["Endereço", "servidor url ip porta conexão conectar"],
    ["Sincronização e backup", "sync aparelhos dispositivos parear código exportar restaurar backup"],
  ],
  [`${C}/administracao`]: [["Nova conta", "criar usuário admin"], ["Contas", "usuários redefinir senha admin"], ["Equipes", "admin"]],
  [`${C}/sobre`]: [["Sobre", "versão licenças código aberto"]],
};

export interface AbaBuscavel { para: string; rotulo: string }
export interface GrupoBuscavel<A extends AbaBuscavel = AbaBuscavel> { titulo: string; abas: A[] }
export interface Resultado<A extends AbaBuscavel = AbaBuscavel> { chave: string; titulo: string; onde: string; destino: string; aba: A }

/**
 * Busca tolerante a acento e maiúsculas: todas as palavras digitadas precisam aparecer no título da opção, nas palavras
 * de apoio ou no nome da aba. Só entram as abas que esta pessoa enxerga. Quem bate no título vem primeiro.
 */
export function buscarConfiguracoes<A extends AbaBuscavel>(consulta: string, grupos: GrupoBuscavel<A>[]): Resultado<A>[] {
  const termos = semAcento(consulta).split(/\s+/).filter(Boolean);
  if (!termos.length) return [];
  const achados: (Resultado<A> & { peso: number })[] = [];
  for (const grupo of grupos) {
    for (const aba of grupo.abas) {
      const onde = `${grupo.titulo} › ${aba.rotulo}`;
      const nomeAba = semAcento(`${aba.rotulo} ${grupo.titulo}`);
      if (termos.every((t) => nomeAba.includes(t))) achados.push({ chave: aba.para, titulo: aba.rotulo, onde: grupo.titulo, destino: aba.para, aba, peso: 0 });
      for (const entrada of INDICE[aba.para] ?? []) {
        const [titulo, palavras] = typeof entrada === "string" ? [entrada, ""] : entrada;
        if (semAcento(titulo) === semAcento(aba.rotulo)) {
          // A entrada é a própria aba: só acrescenta palavras de apoio a ela.
          if (!termos.every((t) => nomeAba.includes(t)) && termos.every((t) => `${nomeAba} ${semAcento(palavras)}`.includes(t))) achados.push({ chave: aba.para, titulo: aba.rotulo, onde: grupo.titulo, destino: aba.para, aba, peso: 2 });
          continue;
        }
        const noTitulo = semAcento(titulo);
        const tudo = `${noTitulo} ${semAcento(palavras)} ${nomeAba}`;
        if (!termos.every((t) => tudo.includes(t))) continue;
        achados.push({ chave: `${aba.para}#${titulo}`, titulo, onde, destino: `${aba.para}#${ancoraDe(titulo)}`, aba, peso: termos.every((t) => noTitulo.includes(t)) ? 1 : 2 });
      }
    }
  }
  return achados.sort((a, b) => a.peso - b.peso).slice(0, 40);
}
