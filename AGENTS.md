# Diretriz de releases do Ecos

- Ao concluir alterações, avaliar se justificam uma nova versão e avisar o usuário quando houver uma funcionalidade relevante, correção crítica, mudança incompatível ou um conjunto coerente de melhorias.
- Apenas recomendar a release. Não incrementar versões, criar tags, publicar releases, enviar commits ao remoto ou distribuir artefatos sem aprovação explícita do usuário.
- Manter o resumo das mudanças pendentes em `CHANGELOG.md`, na seção `Não lançado`.
- Usar SemVer como referência: patch para correções compatíveis, minor para funcionalidades compatíveis e major para mudanças incompatíveis. Durante a fase 0.x, explicitar mudanças incompatíveis e combinar a numeração com o usuário.
- Antes de uma release aprovada, sincronizar versões em package.json, Cargo.toml e tauri.conf.json, atualizar os lockfiles e garantir que o versionCode Android aumente em relação ao último APK distribuído.
- Registrar verificações realizadas e limitações conhecidas. A validação visual e em dispositivo fica com o usuário, salvo pedido contrário.
- Não incluir arquivos pessoais em `ecos-notes/`, credenciais ou artefatos de build nos commits de código.
