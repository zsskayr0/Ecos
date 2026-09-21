-- O nome de usuário também é o nome da pasta da pessoa: `Diogo` e `diogo` seriam a mesma pasta no Windows.
CREATE UNIQUE INDEX idx_usuario_nome_usuario_nocase ON usuario (nome_usuario COLLATE NOCASE);
