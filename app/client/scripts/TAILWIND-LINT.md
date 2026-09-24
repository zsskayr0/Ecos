# Verificação de classes

`npm run lint:tailwind` valida classes estáticas de `className` no código TS/TSX
contra o gerador do Tailwind instalado e as classes declaradas no CSS local.
Também é executado por `npm run build`. `npm run test:lint` testa o verificador,
incluindo a regressão do token `surface-raised` (UI-2).

São percorridos literais, templates, condicionais, constantes e helpers locais.
Classes montadas por fragmentos dinâmicos ou obtidas por índices em mapas não
têm cobertura completa: prefira nomes completos e estáticos. Classes recebidas
por props são verificadas no ponto de uso quando passadas como `className`.
`group` e `peer` são marcadores válidos mesmo sem regra CSS própria.

`tailwind-baseline.json` registra ocorrências anteriores à UI-2, por arquivo,
classe e quantidade. Não é uma lista global de permissões: novas ocorrências
falham. Remova entradas quando corrigir a dívida correspondente; não acrescente
entradas para contornar erros novos. A baseline inclui hooks sem CSS e utilitários
ausentes que precisam de revisão separada.

O script usa APIs internas do Tailwind 3; execute seus testes ao atualizar o
Tailwind. A validação de nomes não substitui revisão visual ou de contraste.
