# Cofre: biometria WebAuthn — situação, opções e decisão pendente

Status: **proposta, sem implementação**. Nada de WebAuthn está ativo no Cofre; este documento existe para que a
decisão de produto/segurança possa ser tomada e para que a implementação não invente um fator falso.

## O que existe hoje (verificado no código)

- A chave do Cofre vem **só da senha** (Argon2id + salt em `ecos-vault.meta.json`; `app/vault/src/routes/ativacao.rs`).
  A chave só existe em memória do processo enquanto o Cofre está aberto; bloquear a descarta.
- "Desbloquear com biometria" na tela de bloqueio é a **senha guardada no aparelho** e liberada pela biometria do
  sistema (Android Keystore via `CofreSenhaBridge.kt`; `lib/cofre-lembrado.ts`). Não é WebAuthn e continua senha por
  baixo. Está em Configurações › Cofre › Segurança.
- `Privacidade & Cofre` mostra "Biometria obrigatória" **desabilitada**, com o texto "Em breve" (honesto: não liga
  nada). Não há rota `/vault/webauthn/*`, nem tabela de credenciais, nem desafios no servidor.

## Por que não dá para "só plugar" WebAuthn

WebAuthn prova **presença/posse** de uma credencial; ele não entrega uma chave de criptografia. Como a chave do Cofre
nasce da senha, um desbloqueio por credencial exige que **alguma** chave sobreviva fora da senha. Há dois desenhos:

1. **Gate sem chave (descartado).** O servidor verifica a asserção e, se válida, abre o Cofre. Para isso o servidor
   precisaria guardar a chave (ou a senha) em disco: quebra a régua "a chave só existe em memória, derivada da
   senha". Equivale a guardar a senha no dispositivo para simular biometria, o que a tarefa proíbe.
2. **Chave embrulhada por PRF (recomendado).** Na criação da credencial o cliente pede a extensão `prf`
   (hmac-secret do autenticador). A saída do PRF, que só o autenticador reproduz, vira uma chave de embrulho (HKDF);
   com ela o cliente cifra a chave do Cofre (que acabou de ser derivada da senha, com o Cofre aberto) e envia **só o
   blob cifrado** ao servidor, junto com a chave pública da credencial. Para desbloquear: desafio único → asserção
   com PRF → servidor valida assinatura/contador/desafio e devolve o blob → cliente desembrulha e entrega a chave ao
   Cofre. A senha continua sendo o fallback e a única forma de criar/trocar credenciais.

## Pontos que dependem de decisão ou de dispositivo (por isso não foi implementado)

- **PRF não é universal.** Depende de navegador/SO/autenticador (Chrome e Android sim, Safari/WebView2/Tauri
  desktop a validar, chaves FIDO2 antigas não). Sem PRF a única opção seria o desenho 1, descartado: então a
  biometria WebAuthn simplesmente não é oferecida nesses aparelhos (fallback por senha, já existente).
- **Nova rota que aceita chave pronta.** O desenho 2 exige um endpoint de desbloqueio que receba a chave derivada
  (não a senha). É uma superfície nova no vault: precisa ser exposta só pelo `ecos-app` autenticado, com rate limit e
  sem log do corpo. Decisão de segurança do dono do produto.
- **Perda do aparelho / revogação.** Revogar apaga o blob e a chave pública no servidor; a senha continua abrindo.
  Trocar a senha do Cofre invalida todos os blobs (a chave muda) e exige recadastro. Falta definir se a troca de
  senha do Cofre existe (hoje não existe; ver também a decisão pendente da chave de recuperação).
- **Cofre de equipe.** A credencial é por pessoa, o Cofre é da equipe: cada pessoa teria o seu blob da mesma chave.
  Precisa de decisão sobre membro removido (blob some junto com o vínculo).
- **Dependências.** Verificação de atestado/asserção no servidor pede CBOR/COSE + P-256 (ex.: `webauthn-rs` ou
  `ciborium` + `p256`), hoje ausentes do `Cargo.lock`. Com `real-sqlcipher` (OpenSSL vendored) é preciso validar que
  a nova árvore não conflita. Não foi adicionada nenhuma dependência.

## Plano de implementação quando a decisão sair

1. Migration do vault: `credencial_webauthn(id, usuario/autor, nome_dispositivo, credential_id, chave_publica,
   contador, blob_chave_embrulhada, criado_em, ultimo_uso_em, revogada_em)` e `desafio_webauthn(id, tipo, valor,
   expira_em, usado_em)`; desafio de uso único, expira em 60 s, validado e consumido numa transação.
2. Rotas (todas exigem Cofre aberto, exceto o par de desbloqueio): `POST /vault/webauthn/registro/inicio|fim`,
   `GET /vault/webauthn/credenciais`, `DELETE /vault/webauthn/credenciais/:id`,
   `POST /vault/webauthn/desbloqueio/inicio|fim`. Administrativas no Cofre de equipe.
3. Cliente: detectar `PublicKeyCredential` + PRF; só então mostrar "Cadastrar biometria"; ligar o toggle
   "Biometria obrigatória" a `GET /vault/config` (campo `exige_credencial`), e a tela de bloqueio a
   `desbloqueio/inicio|fim`. Sem PRF: nada aparece, só a senha.
4. Testes: desafio expirado/reusado, contador regressivo, credencial de outra pessoa, revogada, blob adulterado,
   isolamento entre usuários e equipes. Validação em aparelho (Android, Windows Hello, chave de segurança) é do
   usuário, conforme o `AGENTS.md`.
