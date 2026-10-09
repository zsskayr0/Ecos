# Modelo de uso do Ecos

## Decisão

**Uma instância atende várias pessoas.** Quem hospeda (o operador) instala o Ecos uma vez e cria as contas das demais pessoas; cada uma tem as próprias notas, tarefas, eventos e Cofre, e só compartilha o que colocar numa Equipe.

Não é "uma instância por pessoa" e não é SaaS: não existe cadastro público, nem conta em nuvem, nem servidor central do projeto.

## Como isso funciona na prática

| Ponto | Regra |
|---|---|
| Primeiro acesso | A tela de cadastro só aparece numa instância vazia. A primeira conta vira **administradora** e recebe a chave de recuperação (mostrada uma vez). |
| Cadastro depois disso | Fechado. `POST /auth/registrar` responde `409` quando já existe alguém. Novas contas nascem pela administração do app (`POST /admin/usuarios`), com **senha temporária** que a pessoa é obrigada a trocar no primeiro login. |
| Dados de cada pessoa | Pasta própria no disco (`<login>/Notas`, `<login>/Tarefas`) e Cofre próprio. Uma pessoa não lista, não abre, não edita nem apaga o que é de outra (a API responde `404`, para não confirmar que existe). |
| Compartilhamento | Só por **Equipe** (pasta `<Nome da equipe>/`), por convite (código/QR de uso único, 7 dias) ou pela administração. Cargos: dono, admin, membro. |
| Quem administra | Cria contas, redefine senhas, coloca contas em equipes. **Não lê** as notas de ninguém pela API; mas quem tem acesso ao disco do servidor tem acesso aos arquivos. Por isso o operador deve ser alguém em quem as pessoas confiam (família, equipe pequena). |
| Saída de uma pessoa | A exclusão de conta (`DELETE /me`, com a frase de confirmação) apaga a conta, os arquivos e o Cofre dela, sem depender do operador (LGPD). Dono de equipe com outras pessoas precisa transferir a equipe antes. |
| Escala pretendida | Poucas pessoas (família, equipe pequena) num servidor doméstico, atrás de VPN (Tailscale) ou de um proxy HTTPS. Não há alta disponibilidade nem múltiplos nós. |

Quem prefere isolamento total entre pessoas pode simplesmente subir **uma instância por pessoa** — nada no código impede, e é o modo mais simples de dar "o meu Ecos" a alguém que não deve nem compartilhar o servidor. O que o Ecos garante é o isolamento *dentro* de uma instância; o isolamento *entre* instâncias é o do próprio Docker.

## O que o operador precisa saber

- **Versão fixa em produção.** `ECOS_VERSION=local` é só para desenvolver. Em produção use a versão do release (`ECOS_VERSION=0.10.0-alpha` e `ECOS_REGISTRY=ghcr.io/zsskayr0`) e atualize de propósito com `docker compose pull && docker compose up -d`.
- **Segredos ficam fora das notas.** O segredo de sessão (`segredo-sessao`) e a chave que cifra os tokens do Google Calendar (`chave-calendario`) moram ao lado do índice (volume `ecos-index`, `/data/index`), ou em `ECOS_SECRETS_DIR`, ou em `ECOS_SESSION_SECRET` (variável de ambiente). Copiar a pasta de notas (backup, sincronização, envio a outra pessoa) **não leva** esses segredos. Instalações antigas têm o arquivo movido automaticamente de `<notas>/.ecos/` no primeiro boot depois da atualização, sem derrubar as sessões.
- **Backup completo = notas + volume do índice.** Restaurar só as notas funciona (o índice é reconstruído), mas as pessoas precisarão entrar de novo, e a integração com o Google Calendar terá de ser reconectada.
- **Trocar o segredo derruba todas as sessões.** É o jeito de "deslogar todo mundo" se houver suspeita de vazamento.
- **Testes.** O CI roda `cargo test --workspace` (inclui `app/server/tests`: login, notas, tarefas, equipes, exclusão de conta, segredo), `tsc -b` e `npm test` a cada push. Um push que quebra login ou permissão falha antes de chegar a alguém.
