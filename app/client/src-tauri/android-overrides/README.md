# Personalizações do projeto Android

`src-tauri/gen/` é gerado por `tauri android init` e fica fora do git. O que é do Ecos e precisa sobreviver a uma
regeneração mora aqui e é copiado por cima com `npm run android:aplicar`:

- `AndroidManifest.xml` — igual ao gerado, mais os filtros `SEND`/`SEND_MULTIPLE` de imagem (menu "Compartilhar" → "Ecos", vira nota) e o `activity-alias` `CompartilharCofre` ("Ecos Cofre": imagem ou PDF vira comprovante do Cofre).
- `MainActivity.kt` — recebe a intent e liga a ponte ao WebView.
- `CompartilharBridge.kt` — copia as imagens recebidas pro cache e as entrega ao front (`window.EcosCompartilhar`).
- `CofreSenhaBridge.kt` — "lembrar a senha do Cofre": cifra a senha com chave do Android Keystore liberada por biometria (`window.EcosCofreSenha`); precisa da permissão `USE_BIOMETRIC` do manifesto.

Depois de um `tauri android init` novo, rode `npm run android:aplicar` antes de gerar o APK.
