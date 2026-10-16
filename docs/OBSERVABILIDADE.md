# Observabilidade do Ecos

## Onde ver os logs

Os dois serviços escrevem um objeto JSON por linha na saída padrão, com os campos sensíveis (senha, tokens, valores do Cofre) trocados por `[REDACTED]`.

```
docker compose logs -f ecos-app
docker compose logs -f ecos-vault-db
docker compose logs ecos-app | grep '"nivel":"ERROR"'
```

O que procurar: `"nivel":"ERROR"` e o campo `alvo` (o módulo que falhou). Mensagens que merecem atenção:

| Mensagem (trecho) | Significa |
|---|---|
| `falha ao guardar mídia` / `falha ao guardar foto` | não foi possível gravar um arquivo do usuário em disco |
| `reindex ... falhou` | o índice local não acompanhou os `.md` (a busca e o Feed ficam defasados) |
| `restauração recusada: backup de segurança falhou` | uma restauração foi barrada porque a cópia de segurança não pôde ser feita (nada foi alterado) |
| `backup diário do Cofre falhou` (`ecos-vault-db`) | o backup cifrado do Cofre não foi gerado |
| `push: ...` | problema na fila de push (os avisos continuam na caixa de notificações) |

## Métricas (`GET /metrics`)

Desligado por padrão (responde 404). Para ligar, defina `ECOS_METRICS_TOKEN` no `ecos-app` e faça o scrape com `Authorization: Bearer <token>` (no Prometheus: `authorization: { credentials: <token> }`). Não publique essa rota na internet: use a rede interna do compose.

| Métrica | Rótulos | Uso |
|---|---|---|
| `ecos_http_requests_total` | `metodo`, `rota` (padrão, ex. `/api/v1/notas/:id`), `status` | volume e taxa de 5xx |
| `ecos_http_request_duration_seconds` (histograma) | `rota` | latência |
| `ecos_login_falhas_total` | — | logins recusados (401) |
| `ecos_log_erros_total` | `alvo` (módulo) | todo evento `error` do log: falha de escrita de arquivo, de reindex, de backup de segurança |

Nenhum rótulo carrega usuário, id ou texto de erro.

## Alertas mínimos

`docs/observabilidade/alertas-prometheus.yml` define: servidor fora do ar, qualquer erro registrado, falha de restauração/backup de segurança, taxa de 5xx acima de 5% e excesso de logins recusados. Eles só disparam depois que você ligar um Prometheus + Alertmanager apontando para o `ecos-app` (o Ecos não envia e-mail nem push de operador por conta própria).

Teste do critério "erro forçado aparece no log e dispara o alerta": `cargo test -p ecos-app observabilidade` força um `tracing::error!`, confere a linha JSON estruturada e o incremento de `ecos_log_erros_total`, que é a expressão usada em `EcosErroRegistrado`.

## Limites conhecidos e decisões pendentes

- O `ecos-vault-db` é outro processo e não exporta métricas; a falha do backup diário do Cofre aparece só no log dele (`backup diário do Cofre falhou`). Cobrir isso com alerta exige uma regra sobre logs (Loki/Promtail) ou o mesmo contador no binário do Cofre.
- Não existe backup automático de notas e tarefas; logo não há erro de backup para elas.
- O cliente **não** reporta erros ao servidor. Recomendação: manter assim até haver política de privacidade para isso; se for feito, enviar só tipo de erro, versão do app e rota, nunca texto de nota, e com aceite explícito.
