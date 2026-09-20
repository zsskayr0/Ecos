# Google Calendar no Ecos

Sincronização bidirecional de eventos entre o Ecos e o Google Calendar, mais eventos privados que ficam só no Ecos.

## Como funciona

- **Eventos** são arquivos `.md` em `<espaço>/Eventos/` (o corpo é a descrição). O índice SQLite é derivado, como em Notas e Tarefas.
- **Privado** (padrão): nunca sai do Ecos. **Google**: entra na sincronização.
- **Pull**: carga inicial dos últimos 90 dias (`timeMin`), depois incremental com `syncToken`. `410 Gone` refaz a carga completa.
  O job roda a cada `ECOS_CALENDARIO_INTERVAL_SECS` (padrão 300, mínimo 60); falhas transitórias dobram o intervalo (até 16x).
  Há polling porque o webhook do Google exige HTTPS público, o que não combina com LAN/Tailscale.
- **Conflito**: vale o mais recente entre `updated` (Google) e `atualizado_em` (local). Edição local pendente e mais nova é mantida.
- **Apagado no Google** → o evento local vai para a Lixeira (recuperável).
- **Desconectar**: os eventos ficam no Ecos, privados e sem vínculo; o token é revogado no Google.
- **Push (Ecos → Google)**, depois do pull no mesmo ciclo (e ~1,5 s depois de criar/editar/apagar, se `ECOS_CALENDARIO_ENVIO_IMEDIATO`
  não estiver desligado):
  - evento `google` novo → `events.insert`; editado → `events.patch` só com os campos que o Ecos controla (convidados e lembretes do Google não são tocados), com `If-Match`;
  - `412` (mudou no Google desde a última leitura) → **não sobrescreve**: adia, e o próximo pull decide pelo mais recente;
  - `404` num evento com edição pendente → recria (a edição não se perde);
  - tornado **privado** ou **excluído** no Ecos → apagado no Google. A exclusão fica registrada em `evento_exclusao_google` até ser enviada (o `.md` já foi para a Lixeira);
  - a categoria e o id do Ecos vão em `extendedProperties.private` (`ecos_categoria`, `ecos_id`) e sobrevivem a edições feitas no Google;
  - dia inteiro vai como data (fuso do evento, ou do calendário); série vai com a `RRULE` e `timeZone`;
  - erro do Google num evento (dados inválidos) deixa **só ele** pendente e segue com os outros; rede, `429` e `5xx` interrompem o ciclo (backoff do job).
- **Vínculos com Tarefa/Nota nunca vão ao Google.**

## Editor de evento

Um só editor (o de tela cheia, com prévia ao vivo no cabeçalho) serve à Agenda ("+ Evento", clicar num evento) e à aba **Eventos**, para criar e para editar.
Blocos: **Quando** · **Repetir** (só leitura: a regra é do Google) · **Sincronização** (só no Ecos / Google Calendar) · **Cor** · **Categoria** · **Local** · **Descrição** · **Vínculos** (Tarefas e Notas).

- **Cor**: a própria do evento vale sobre a da categoria (só do Ecos, nunca vai ao Google); "Voltar à cor da categoria" a tira. Sem nenhuma, vale o ciano padrão.
- **Modos**: evento comum (tudo editável) · **só esta ocorrência** (quando, local e descrição) · **série do Google** (só cor, categoria e vínculos) ·
  evento de **vários dias** (o horário é do Google; o resto edita).
- O editor manda ao servidor **só o que mudou**: mexer só em cor, categoria ou vínculos nunca marca o evento para o Google.

## Séries (eventos que se repetem)

**A série é do Google; no Ecos se muda uma ocorrência de cada vez.**

- **Criar, mudar a regra e apagar a série inteira**: só no Google Calendar. No Ecos, uma série vinda de lá é protegida: o servidor recusa (`409`)
  editar título/horário/local/descrição/privacidade e apagar. Categoria e vínculos com Tarefa/Nota continuam livres (e só o metadado do Ecos, `extendedProperties`,
  vai ao Google; horário e regra nunca são reescritos, porque isso pode descartar as exceções da série).
- **Uma ocorrência** (`PATCH /eventos/:id/ocorrencias` e `DELETE /eventos/:id/ocorrencias?original=...`): muda título, horário, local ou descrição só daquele dia, ou o cancela.
  Na Agenda: clicar edita só ela; arrastar move só ela; o botão de excluir cancela só ela.
- **Como fica guardado**: em `excecoes:` no `.md` da série, chaveado pelo início **original** da ocorrência, só com os campos que mudaram (o resto herda da série).
  `EXDATE`/`RDATE` da série ficam em `recorrencia_extra` e são reenviados intactos.
- **No Google** cada exceção é o "evento-instância": vem no pull com `recurringEventId` + `originalStartTime` (ocorrência cancelada vem como `cancelled`); o envio acha o id da instância
  (`events.instances`, uma vez) e faz `PATCH` com `If-Match` (ou `DELETE`, se cancelada). `412` adia; instância que já não existe é descartada do envio sem erro.
- **Conflito**: mesma regra dos eventos simples (vale o mais recente, por ocorrência).
- **A Agenda** expande a regra no navegador (`DAILY/WEEKLY/MONTHLY/YEARLY` com `INTERVAL`, `BYDAY` semanal, `COUNT`, `UNTIL`), tira `EXDATE` e ocorrências canceladas e
  põe as exceções no lugar. Regra mais complexa (`BYSETPOS`, `2MO`…): mostra só o evento original, para não inventar datas.
- **Limites conhecidos**: "esta e as seguintes" (dividir a série) é do Google; `EXDATE` sem fuso é lido no relógio local do navegador; a aba **Tempo** ainda deixa as séries de fora da soma
  (`recorrentes_ignorados`); regras que a Agenda não sabe expandir aparecem só uma vez.

## Segurança

- Tokens ficam cifrados (AES-256-GCM) em `config_calendario`. A chave é `<notes_root>/.ecos/chave-calendario` (gerada no primeiro uso).
  **Faça backup dessa chave junto do backup das notas**; sem ela os tokens ficam ilegíveis e é preciso reconectar.
- OAuth com PKCE (S256). O `state` é aleatório, de uso único e expira em 10 minutos. O callback é público (o Google não envia cookie) e tem limite de taxa.
- `GOOGLE_CLIENT_SECRET` só existe no ambiente do servidor; nunca vai para a URL, o navegador ou os logs.

## Configuração (uma vez)

1. Google Cloud Console → novo projeto → ativar a **Google Calendar API**.
2. Google Auth Platform: Branding, Público-alvo **Externo**, usuário de teste = sua conta, escopo `https://www.googleapis.com/auth/calendar`.
3. Clientes → criar cliente do tipo **App para computador** (aceita `http://127.0.0.1:<porta>` como retorno, sem registrar a URL).
4. No `.env` do servidor:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```
5. Reinicie o servidor e, em **Configurações → Calendário**, clique em **Conectar**.

### Refresh token de 7 dias

Com o app em modo **Teste**, o Google expira o refresh token em 7 dias. Depois de validar, use **Publicar app**
(Público-alvo) para o token não expirar. Para uso pessoal o aviso de "app não verificado" é aceitável.

### Conectar exige `localhost`

O Google só aceita retorno em loopback sem HTTPS. Abra o Ecos por `http://localhost:PORTA` (ou `127.0.0.1`) **no computador do
servidor** para conectar; depois de conectado, o sync roda no servidor e o acesso pode ser por qualquer endereço.

## Variáveis

| Variável | Padrão | |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | Sem as duas, a integração fica desligada |
| `ECOS_CALENDARIO_INTERVAL_SECS` | 300 | Intervalo do sync (mínimo 60) |
| `ECOS_CALENDARIO_ENVIO_IMEDIATO` | true | Envia ao Google logo após criar/editar/apagar, sem esperar o ciclo |
| `GOOGLE_AUTH_URL`, `GOOGLE_TOKEN_URL`, `GOOGLE_REVOKE_URL`, `GOOGLE_API_BASE` | endereços do Google | Só para testes (servidor de mentira) |

## API

`GET /calendario/config` · `GET /calendario/conectar/google` · `GET /calendario/callback/google` (público) ·
`POST /calendario/sincronizar` · `DELETE /calendario/google`.
