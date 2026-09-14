# Status da implementação — o que foi feito e o que falta

Mapeado seção a seção contra `ecos-arquitetura-tecnica.md`. "Feito" =
funciona de ponta a ponta contra o banco/arquivo real, testado (unitário
e/ou smoke manual). "Stub" = rota existe com contrato correto, corpo
`TODO`. "Não existe" = nem rota foi criada.

## 1. Modelo de dados

| Item | Estado |
|---|---|
| Schema do índice local (Nota/Tarefa/Pasta/Documento/Equipe/Rotina/Notificação/Dispositivo/ConfigSync/Calendário) + FTS5 | ✅ Feito |
| Schema do Vault (Categoria/Conta/Beneficiário/Transação/Recorrência/Anexo/Pendência) | ✅ Feito |
| Front-matter parse/serialize preservando corpo byte a byte | ✅ Feito (testado) |
| Wikilink → `links_nota` (critério Órfã) | ✅ Feito (testado) |
| Reindex completo a partir dos `.md`, derivação de Pasta/Documento | ✅ Feito |
| Nome de arquivo = título, sanitização, colisão com sufixo `(2)` | ✅ Feito (testado) |
| Modo Página (`pagina.json`) | 🟡 Persiste o JSON; **não regenera `pagina.svg`** (exige renderizador de canvas, é trabalho de cliente) |
| Foto rápida / desenho embutido no Modo Texto (`_anexos/`) | ❌ Não existe endpoint de upload — só a leitura por reindex está pronta |
| Importador de outro app (seção 1.6) | ❌ Não existe |
| Documento (PDF) | ✅ Descoberta via reindex + `GET /documentos/:hash`; upload não é via API (é o usuário colocando o arquivo na pasta, como o desenho prevê) |

## 2/3. Docker & DevOps

| Item | Estado |
|---|---|
| Dockerfiles multi-stage, não-root | ✅ Feito, build validado (inclusive `--features real-sqlcipher` em Linux) |
| docker-compose.yml + staging, rede `internal` isolando o vault | ✅ Feito, `up`/proxy validados |
| `/health`, `/health/ready` | ✅ Feito |
| Logs JSON com sanitizer de campo sensível | ✅ Feito |
| `/metrics` (Prometheus) | ❌ Não existe |
| Backup diário + retenção 7/4/3, export CSV manual | ✅ Feito (vault) |

## 4. Job de ranking do Feed

| Item | Estado |
|---|---|
| 4 fórmulas + desempate de motivo | ✅ Feito (testado) |
| Job periódico gravando `feed_item`, Tarefa encaixada, boost de Transação | ✅ Feito |
| OCR de foto (Nível 1 cliente / Nível 2 servidor, Tesseract) | ❌ Não implementado — `captura-foto` devolve rascunho vazio |

## 5. Segurança

| Item | Estado |
|---|---|
| Registro/login/logout, Argon2id, recovery key BIP39 (24 palavras) | ✅ Feito |
| Cookie de sessão `HttpOnly/Secure/SameSite=Strict` + refresh separado | ✅ Feito, `Set-Cookie` conferido em Docker |
| Rate limit por IP (janela deslizante) — global + rotas sensíveis | ✅ Feito (implementação própria, não `tower-governor`) |
| Cabeçalhos de segurança (CSP, nosniff, referrer-policy), CORS same-origin | ✅ Feito |
| Confirmação por frase em ação destrutiva (Equipe, `/me`, `/vault/reset`) | ✅ Feito |
| Comparação em tempo constante explícita (`subtle`) | 🟡 Dependência declarada mas **não usada** — senha/recovery já passam pelo Argon2 (seguro por natureza); código de pareamento LAN e tokens ainda comparam via `HashMap`/igualdade comum, não via `subtle` |
| Biometria WebAuthn no Cofre | ❌ Não existe endpoint — só senha (real) faz a derivação de chave |

## 6. Sincronização

| Item | Estado |
|---|---|
| Pareamento por código (posse física) + tabela `dispositivo` | ✅ Feito |
| Anúncio mDNS (`_ecos._tcp.local`) | ✅ Feito |
| Handshake de hash/timestamp e transferência cifrada entre pareados | ❌ Não implementado (só a descoberta) |
| Google Drive (sync opt-in) | ❌ Não implementado, nem stub |
| Calendário externo (OAuth Google/Microsoft) | 🟡 `GET config`/`DELETE` reais; `conectar`/`callback` = `501 NOT_IMPLEMENTED` |
| Push UnifiedPush/FCM | 🟡 CRUD de `push_tipo`/`push_endpoint` real; **nada de fato envia push** — só o polling (`GET /notificacoes`) funciona como fallback |

## 7. Resiliência

| Item | Estado |
|---|---|
| Catálogo de erros literal (`{error, message}`), 422 com lista de campos | ✅ Feito (testado) |
| Estados de erro da tabela 7.1 (sync pendente/conflito, vault bloqueado/desativado) | ✅ Feito onde há dado real por trás; conflito de sync não se aplica ainda (sem transporte) |

## 8. Políticas

| Item | Estado |
|---|---|
| `GET /me/export` | 🟡 Manifesto JSON (caminhos de Notas/Tarefas); **não gera `.zip`** |
| `DELETE /me`, `DELETE /equipes/:id` com confirmação | ✅ Feito |
| Templates de Política de Privacidade/Termos | ❌ Não é código — fica pro operador adaptar (texto, fora de escopo de backend) |

## 11. Contrato de API — cobertura por grupo

| Grupo | Estado |
|---|---|
| Auth & Perfil, Captura, Notas, Pastas, Tarefas/Agenda, Feed, Busca, Rotina, Equipes, Sistema | ✅ Real |
| Notificações | 🟡 CRUD real, mas **nada ainda escreve notificação** (sync/calendário que gerariam alertas não existem de verdade) |
| Sincronização & Dispositivos | 🟡 Ver seção 6 acima |
| Calendário externo | 🟡 Ver seção 6 acima |
| Cofre (`/vault/*`) | ✅ Real, exceto `captura-foto` (OCR) e biometria |

## Qualidade / verificação

- 51 testes unitários (`ecos-core` 36, `ecos-app` 11, `ecos-vault-db` 4), todos verdes.
- Smoke manual nativo: registro → login → Nota com wikilink resolvido → busca FTS5 → ativação do Cofre → transação com saldo calculado → erro 422 do catálogo → reset bloqueado sem frase.
- Smoke manual via Docker: build de `ecos-app` e `ecos-vault-db` (com SQLCipher real) OK; `docker compose up` com os dois profiles; `/health/ready` confirma `ecos-app` alcançando `ecos-vault-db` pela rede `internal`; proxy `/api/v1/vault/*` propaga a régua de sessão.

## Maiores lacunas pra próxima rodada

1. **Upload de anexo em Nota** (foto/desenho no Modo Texto) — hoje só existe pro Cofre (comprovante).
2. **Transporte de sync LAN** — pareamento existe, mover arquivo entre dispositivos não.
3. **OCR** e **WebAuthn** — dependem de lib nativa (Tesseract) e de hardware/browser, respectivamente; melhor validar em spike isolado antes de integrar à UI (mesma recomendação do documento de arquitetura).
4. **Notificação real** — nada popula `notificacao` hoje porque os produtores (sync/calendário) ainda não existem.
5. **Importador de outro app** (seção 1.6) — zero código ainda.
