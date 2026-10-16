/**
 * Texto de erro para a pessoa: nomes de campo do servidor viram rótulos em português e o limite de tentativas
 * (RATE_LIMITED, 429) ganha mensagem própria com o tempo de espera. Fica fora de `api.ts` para não gerar ciclo.
 */

const ROTULOS_CAMPO: Record<string, string> = {
  nome_usuario: "Nome de usuário",
  senha: "Senha",
  nova_senha: "Nova senha",
  nome: "Nome",
  titulo: "Título",
  corpo: "Texto",
  conteudo: "Conteúdo",
  "pagina.json": "Conteúdo da página",
  duration_min: "Duração",
  duracao_min: "Duração",
  inicio: "Início",
  fim: "Fim",
  ate: "Até",
  local: "Local",
  fuso: "Fuso horário",
  rrule: "Repetição",
  espaco: "Espaço",
  pasta: "Pasta",
  tipo: "Tipo",
  cor: "Cor",
  cargo: "Cargo",
  papel: "Papel",
  status: "Situação",
  tarefas: "Tarefas",
  notas: "Notas",
  arquivo: "Arquivo",
  host: "Endereço do servidor",
  modo: "Modo",
  categoria_id: "Categoria",
  usuario_id: "Pessoa",
  dias_semana: "Dias da semana",
  classificacao: "Classificação",
  pais: "País",
  origens: "Origens",
  original: "Arquivo original",
  versao: "Versão",
  push_tipo: "Tipo de aviso",
  campos: "Dados enviados",
  declara_idade_minima: "Idade mínima",
  aceita_termos: "Termos de uso",
};

export function rotuloDoCampo(campo: string): string {
  return ROTULOS_CAMPO[campo] ?? "";
}

export function mensagemDeCampos(campos: { campo: string; motivo: string }[]): string {
  return campos
    .map(({ campo, motivo }) => {
      const rotulo = ROTULOS_CAMPO[campo];
      return rotulo ? `${rotulo}: ${motivo}` : motivo;
    })
    .join(" · ");
}

/** "Tente de novo em 45 segundos" / "em 2 minutos". */
export function mensagemLimiteDeTentativas(segundos?: number): string {
  if (!segundos || segundos <= 0) return "Muitas tentativas em pouco tempo. Aguarde um momento e tente de novo.";
  if (segundos < 60) return `Muitas tentativas em pouco tempo. Tente de novo em ${segundos} segundo${segundos === 1 ? "" : "s"}.`;
  const minutos = Math.ceil(segundos / 60);
  return `Muitas tentativas em pouco tempo. Tente de novo em ${minutos} minuto${minutos === 1 ? "" : "s"}.`;
}

/**
 * Mensagem única para qualquer falha de tela. Erros da API (que já chegam em português e sem nome técnico) passam
 * como estão; qualquer outra coisa (exceção de runtime, texto de biblioteca) vira `padrao`, nunca texto cru.
 */
export function mensagemDeErro(erro: unknown, padrao: string): string {
  if (erro instanceof Error && "code" in erro && "status" in erro && erro.message) return erro.message;
  return padrao;
}
