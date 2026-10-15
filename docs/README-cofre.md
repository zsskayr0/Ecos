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

O Cofre não tem recovery key: a chave de criptografia vem só da senha, e a recovery key da sua
conta do Ecos (mostrada uma única vez no cadastro) não abre o Cofre. Guarde a senha do Cofre em um
lugar seguro, por exemplo um gerenciador de senhas.

### Importante

- A senha do Cofre não é recuperável pelos autores do Ecos, nem por ninguém além de você.
- Se você perder a senha, os dados do Cofre ficam permanentemente inacessíveis. Não existe
  recuperação alternativa; só é possível resetar o Cofre (Configurações › Privacidade e cofre),
  o que apaga os lançamentos.
- Desativar o Cofre depois (derrubando o container) não apaga os dados — eles continuam no volume
  Docker até você decidir removê-lo explicitamente.

---

*Copiado literalmente da seção 12 de `ecos-arquitetura-tecnica.md` — é o texto que a tela de
teaser do Cofre no cliente linka.*
