## Ativar o Cofre

O Cofre é o módulo financeiro do Ecos. Ele é opcional e fica desativado por padrão — os dados
financeiros vivem num banco separado e criptografado, isolado do resto do sistema.

### 1. Suba o container do Cofre

No diretório onde está o `docker-compose.yml` da sua instância:

    docker compose --profile vault --profile default up -d

Isso inicia o `ecos-vault-db` (o banco criptografado do Cofre) junto com o restante da instância.

### 2. Defina a senha do Cofre

Abra o Ecos e toque no ícone do Cofre. No primeiro acesso, você vai definir uma senha exclusiva
do Cofre (pode ser igual ou diferente da senha da sua conta). Essa senha é a única forma de gerar
a chave de criptografia dos seus dados financeiros — ninguém além de você tem acesso a ela.

Nesse mesmo passo, uma recovery key é gerada e exibida uma única vez. Guarde-a em um lugar seguro,
fora deste dispositivo.

### Importante

- A senha do Cofre não é recuperável pelos autores do Ecos, nem por ninguém além de você.
- Se você perder a senha e não tiver a recovery key, os dados do Cofre ficam permanentemente
  inacessíveis. Não existe recuperação alternativa.
- Desativar o Cofre depois (derrubando o container) não apaga os dados — eles continuam no volume
  Docker até você decidir removê-lo explicitamente.

---

*Copiado literalmente da seção 12 de `ecos-arquitetura-tecnica.md` — é o texto que a tela de
teaser do Cofre no cliente linka.*
