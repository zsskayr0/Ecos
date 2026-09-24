const CACHE_SHELL = "ecos-shell-v1";
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

  evento.respondWith(
    caches.match(pedido).then((salva) => {
      const rede = fetch(pedido).then((resposta) => {
        if (resposta.ok) void caches.open(CACHE_SHELL).then((cache) => cache.put(pedido, resposta.clone()));
        return resposta;
      });
      return salva || rede;
    }),
  );
});
