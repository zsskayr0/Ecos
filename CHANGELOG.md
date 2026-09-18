# Changelog

## Não lançado

Sem alterações pendentes.

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
