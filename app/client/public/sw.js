const CACHE_SHELL = "ecos-shell-v2";
const ARQUIVOS_INICIAIS = ["/", "/index.html", "/favicon.svg"];

self.addEventListener("install", (evento) => {
  evento.waitUntil(caches.open(CACHE_SHELL).then((cache) => cache.addAll(ARQUIVOS_INICIAIS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((chave) => chave.startsWith("ecos-shell-") && chave !== CACHE_SHELL).map((chave) => caches.delete(chave))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (evento) => {
  const pedido = evento.request;
  const url = new URL(pedido.url);
  if (pedido.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/health/")) return;

  if (pedido.mode === "navigate") {
    evento.respondWith(
      fetch(pedido)
        .then((resposta) => {
          const copia = resposta.clone();
          void caches.open(CACHE_SHELL).then((cache) => cache.put("/index.html", copia));
          return resposta;
        })
        .catch(async () => (await caches.match("/index.html")) || Response.error()),
    );
    return;
  }

  // Arquivos com hash em /assets/ nunca mudam: cache primeiro. Todo o resto (módulos do vite em desenvolvimento,
  // sw.js, manifest, tema-inicial.js…) vai à rede primeiro e só cai no cache quando a rede some. Antes tudo era
  // "cache primeiro", e um cache de uma visita anterior servia módulos velhos misturados com os novos.
  if (url.pathname.startsWith("/assets/")) {
    evento.respondWith(
      caches.match(pedido).then((salva) => salva || fetch(pedido).then((resposta) => {
        if (resposta.ok) void caches.open(CACHE_SHELL).then((cache) => cache.put(pedido, resposta.clone()));
        return resposta;
      })),
    );
    return;
  }

  evento.respondWith(
    fetch(pedido)
      .then((resposta) => {
        if (resposta.ok) void caches.open(CACHE_SHELL).then((cache) => cache.put(pedido, resposta.clone()));
        return resposta;
      })
      .catch(async () => (await caches.match(pedido)) || Response.error()),
  );
});
