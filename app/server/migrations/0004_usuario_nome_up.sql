-- User feedback: o cadastro só pedia "nome de usuário" (login), sem nome de
-- verdade pra exibir — Feed/Equipe já mostram nome+avatar do dono de um
-- item (seção migração 0003), mas o único usuário local nunca tinha um
-- nome de exibição real. Opcional (usuários já registrados antes disso
-- ficam com NULL — o cliente cai pro nome_usuario nesse caso).
ALTER TABLE usuario ADD COLUMN nome TEXT;
