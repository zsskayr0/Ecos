//! Cabeçalhos HTTP globais: CORS com max-age, gzip, Cache-Control dos estáticos e preflight fora do rate limit.

mod comum;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use comum::nova;
use tower::Service;

fn pedido(metodo: &str, uri: &str, extra: &[(&str, &str)]) -> Request<Body> {
    let origem: std::net::SocketAddr = "127.0.0.1:50001".parse().unwrap();
    let mut r = Request::builder().method(metodo).uri(uri).extension(axum::extract::ConnectInfo(origem));
    for (k, v) in extra {
        r = r.header(*k, *v);
    }
    r.body(Body::empty()).unwrap()
}

fn app_com_estaticos() -> (comum::Instancia, axum::Router, std::path::PathBuf) {
    let e = nova();
    let dir = e.raiz.join("dist");
    std::fs::create_dir_all(dir.join("assets")).unwrap();
    std::fs::write(dir.join("index.html"), "<!doctype html><html><body>ecos</body></html>").unwrap();
    std::fs::write(dir.join("assets/app-AbCd1234.js"), "console.log('ecos');\n".repeat(400)).unwrap();
    let app = ecos_app::middleware::camadas::completar(ecos_app::routes::montar(e.state.clone()), Some(&dir));
    (e, app, dir)
}

#[tokio::test]
async fn estaticos_tem_cache_correto_e_js_vai_em_gzip() {
    let (_e, mut app, _d) = app_com_estaticos();

    let r = app.call(pedido("GET", "/assets/app-AbCd1234.js", &[("accept-encoding", "gzip")])).await.unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(r.headers()[header::CACHE_CONTROL], "public, max-age=31536000, immutable");
    assert_eq!(r.headers()[header::CONTENT_ENCODING], "gzip");

    let r = app.call(pedido("GET", "/assets/app-AbCd1234.js", &[])).await.unwrap();
    assert!(r.headers().get(header::CONTENT_ENCODING).is_none(), "sem Accept-Encoding não comprime");

    for caminho in ["/index.html", "/", "/rota/do/spa"] {
        let r = app.call(pedido("GET", caminho, &[])).await.unwrap();
        assert_eq!(r.headers()[header::CACHE_CONTROL], "no-cache", "{caminho}");
    }
}

#[tokio::test]
async fn preflight_cacheado_por_2h_e_nao_conta_no_rate_limit() {
    let (_e, mut app, _d) = app_com_estaticos();
    let preflight = [("origin", "tauri://localhost"), ("access-control-request-method", "GET"), ("access-control-request-headers", "authorization")];
    let r = app.call(pedido("OPTIONS", "/api/v1/notas", &preflight)).await.unwrap();
    assert_eq!(r.headers()["access-control-max-age"], "7200");

    // O limite global é 300/min por IP: 400 preflights seguidos não podem gastá-lo.
    for _ in 0..400 {
        app.call(pedido("OPTIONS", "/api/v1/notas", &preflight)).await.unwrap();
    }
    let r = app.call(pedido("GET", "/health", &[])).await.unwrap();
    assert_eq!(r.status(), StatusCode::OK, "preflights não podem esgotar o rate limit");
}

#[tokio::test]
async fn respostas_da_api_nao_ganham_cache_e_json_vai_em_gzip() {
    let (e, mut app, _d) = app_com_estaticos();
    let (_, token) = e.admin("diogo").await;
    for i in 0..30 {
        e.chamar("POST", "/api/v1/notas", Some(&token), Some(serde_json::json!({ "titulo": format!("Nota {i}"), "corpo": "texto ".repeat(80) }))).await;
    }
    let bearer = format!("Bearer {token}");
    let r = app.call(pedido("GET", "/api/v1/notas", &[("authorization", bearer.as_str()), ("accept-encoding", "gzip")])).await.unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(r.headers()[header::CONTENT_ENCODING], "gzip");
    assert!(r.headers().get(header::CACHE_CONTROL).is_none(), "a API não ganha Cache-Control aqui");
}
