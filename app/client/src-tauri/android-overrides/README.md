# Personalizações do projeto Android

`src-tauri/gen/` é gerado por `tauri android init` e fica fora do git. O que é do Ecos e precisa sobreviver a uma
regeneração mora aqui e é copiado por cima com `npm run android:aplicar`:

- `AndroidManifest.xml` — igual ao gerado, mais os filtros `SEND`/`SEND_MULTIPLE` de imagem (menu "Compartilhar").
- `MainActivity.kt` — recebe a intent e liga a ponte ao WebView.
- `CompartilharBridge.kt` — copia as imagens recebidas pro cache e as entrega ao front (`window.EcosCompartilhar`).

Depois de um `tauri android init` novo, rode `npm run android:aplicar` antes de gerar o APK.
