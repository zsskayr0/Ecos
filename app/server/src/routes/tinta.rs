//! Modo de escrita (seção 1.3): tinta à mão sobre a Nota.
//!
//! A tinta mora em `_anexos/<nota_id>/tinta.json` (fonte de verdade) ao lado do `.md`, que segue
//! prosa Markdown sem alteração. `tinta.svg` é derivado e **montado aqui**, a partir dos traços
//! validados: o servidor nunca grava SVG vindo do cliente (multiusuário, SVG executa script).
//! O índice SQLite não guarda nada da tinta, então apagar `ecos-index.db` não perde traço algum;
//! mover de pasta, lixeira e restauração já levam a pasta `_anexos/<id>` inteira.
//!
//! Concorrência: `revisao` sobe a cada PUT aceito; o PUT envia `revisao_base` e, se divergir,
//! recebe 409 e o cliente relê. Sem traço ativo, os dois arquivos são apagados e a Nota volta
//! à largura fluida.

use axum::extract::{Path, State};
use axum::{Extension, Json};
use chrono::{DateTime, Duration, Utc};
use ecos_core::ErrorCode;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path as FsPath;

use crate::error::{AppError, AppResult, CampoInvalido};
use crate::middleware::auth_guard::UsuarioAutenticado;
use crate::routes::notas::{anexos_dir, caminho_por_id};
use crate::state::AppState;

pub const ARQUIVO_JSON: &str = "tinta.json";
pub const ARQUIVO_SVG: &str = "tinta.svg";
pub const VERSAO: u32 = 1;
/// Largura de uma folha A4 (210 mm) a 96 dpi.
pub const LARGURA_PADRAO: u32 = 794;
pub const TAMANHO_MAXIMO_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_PONTOS_TOTAL: usize = 50_000;
pub const MAX_PONTOS_TRACO: usize = 5_000;
pub const MAX_TRACOS: usize = 5_000;
pub const MAX_D_TRACO: usize = 64_000;
/// Lápides mais antigas que isto são podadas no PUT.
const DIAS_LAPIDE: i64 = 30;
/// Cor usada no `tinta.svg` externo para `auto` (fora do Ecos não há tema).
const COR_AUTO_SVG: &str = "#1f2937";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Ferramenta {
    Caneta,
    MarcaTexto,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Ponto {
    pub x: f64,
    pub y: f64,
    #[serde(default = "pressao_padrao")]
    pub pressao: f64,
}

fn pressao_padrao() -> f64 {
    0.5
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Traco {
    pub id: String,
    pub ferramenta: Ferramenta,
    pub cor: String,
    pub espessura: f64,
    pub pontos: Vec<Ponto>,
    /// Caneta: contorno fechado (preenchido). Marca-texto: linha central (traçada com `espessura`).
    pub d: String,
    pub criado_em: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub apagado_em: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tinta {
    pub versao: u32,
    pub revisao: u64,
    /// `None` = Nota nunca convertida (largura fluida).
    pub largura_coluna: Option<u32>,
    pub tracos: Vec<Traco>,
}

impl Tinta {
    fn vazia() -> Self {
        Self { versao: VERSAO, revisao: 0, largura_coluna: None, tracos: vec![] }
    }
}

#[derive(Debug, Deserialize)]
pub struct SalvarTinta {
    pub revisao_base: u64,
    pub largura_coluna: u32,
    pub tracos: Vec<Traco>,
}

fn invalido(campo: impl Into<String>, motivo: impl Into<String>) -> AppError {
    AppError::validation(vec![CampoInvalido { campo: campo.into(), motivo: motivo.into() }])
}

fn ler(dir: &FsPath) -> AppResult<Tinta> {
    let caminho = dir.join(ARQUIVO_JSON);
    if !caminho.is_file() {
        return Ok(Tinta::vazia());
    }
    let bruto = std::fs::read_to_string(caminho)?;
    serde_json::from_str(&bruto).map_err(|_| invalido(ARQUIVO_JSON, "arquivo corrompido"))
}

pub fn d_valido(d: &str) -> bool {
    !d.is_empty() && d.len() <= MAX_D_TRACO && d.bytes().all(|b| matches!(b, b'M' | b'm' | b'L' | b'l' | b'H' | b'h' | b'V' | b'v' | b'C' | b'c' | b'Q' | b'q' | b'S' | b's' | b'T' | b't' | b'Z' | b'z' | b'0'..=b'9' | b' ' | b'.' | b',' | b'-'))
}

pub fn cor_valida(cor: &str) -> bool {
    cor == "auto" || (cor.len() == 7 && cor.starts_with('#') && cor[1..].bytes().all(|b| b.is_ascii_hexdigit()))
}

fn id_valido(id: &str) -> bool {
    (1..=40).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Validação completa do PUT (seção 4 do TASK). Erro devolve o campo exato.
pub fn validar(p: &SalvarTinta) -> AppResult<()> {
    if !(320..=2000).contains(&p.largura_coluna) {
        return Err(invalido("largura_coluna", "fora da faixa 320–2000"));
    }
    if p.tracos.len() > MAX_TRACOS {
        return Err(invalido("tracos", format!("máximo de {MAX_TRACOS} traços")));
    }
    let mut ids = HashSet::new();
    let mut total = 0usize;
    let limite_x = p.largura_coluna as f64 * 2.0;
    for (i, t) in p.tracos.iter().enumerate() {
        let campo = |c: &str| format!("tracos[{i}].{c}");
        if !id_valido(&t.id) {
            return Err(invalido(campo("id"), "id inválido"));
        }
        if !ids.insert(t.id.as_str()) {
            return Err(invalido(campo("id"), "id repetido"));
        }
        if !cor_valida(&t.cor) {
            return Err(invalido(campo("cor"), "use \"auto\" ou #rrggbb"));
        }
        if !t.espessura.is_finite() || !(0.5..=64.0).contains(&t.espessura) {
            return Err(invalido(campo("espessura"), "fora da faixa 0,5–64"));
        }
        if t.pontos.is_empty() || t.pontos.len() > MAX_PONTOS_TRACO {
            return Err(invalido(campo("pontos"), format!("entre 1 e {MAX_PONTOS_TRACO} pontos")));
        }
        total += t.pontos.len();
        if total > MAX_PONTOS_TOTAL {
            return Err(invalido("tracos", format!("máximo de {MAX_PONTOS_TOTAL} pontos no total")));
        }
        for pt in &t.pontos {
            let ok = pt.x.is_finite() && pt.y.is_finite() && pt.pressao.is_finite() && (-limite_x..=limite_x).contains(&pt.x) && (-1000.0..=1_000_000.0).contains(&pt.y) && (0.0..=1.0).contains(&pt.pressao);
            if !ok {
                return Err(invalido(campo("pontos"), "coordenada ou pressão fora da faixa"));
            }
        }
        if !d_valido(&t.d) {
            return Err(invalido(campo("d"), "caminho SVG inválido"));
        }
    }
    Ok(())
}

/// SVG externo (visível fora do Ecos), montado só com dado validado.
pub fn montar_svg(largura: u32, tracos: &[Traco]) -> String {
    let ativos: Vec<&Traco> = tracos.iter().filter(|t| t.apagado_em.is_none()).collect();
    let altura = ativos
        .iter()
        .flat_map(|t| t.pontos.iter().map(move |p| p.y + t.espessura))
        .fold(0.0f64, f64::max)
        .ceil()
        .max(1.0)
        + 16.0;
    let mut s = format!("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {largura} {altura}\" width=\"{largura}\" height=\"{altura}\">\n");
    for t in ativos {
        let cor = if t.cor == "auto" { COR_AUTO_SVG } else { t.cor.as_str() };
        match t.ferramenta {
            Ferramenta::Caneta => s.push_str(&format!("  <path d=\"{}\" fill=\"{cor}\"/>\n", t.d)),
            Ferramenta::MarcaTexto => s.push_str(&format!(
                "  <path d=\"{}\" fill=\"none\" stroke=\"{cor}\" stroke-width=\"{}\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-opacity=\"0.35\"/>\n",
                t.d, t.espessura
            )),
        }
    }
    s.push_str("</svg>\n");
    s
}

fn gravar_atomico(caminho: &FsPath, conteudo: &[u8]) -> std::io::Result<()> {
    let tmp = caminho.with_extension("tmp");
    std::fs::write(&tmp, conteudo)?;
    std::fs::rename(&tmp, caminho)
}

/// Serializa os PUTs de tinta (ler revisão → gravar) para o 409 valer entre abas.
static TRAVA: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub async fn obter(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>) -> AppResult<Json<Tinta>> {
    let rel = caminho_por_id(&state, &usuario.0, &id).await?;
    let mut tinta = ler(&anexos_dir(&state, &id, &rel))?;
    tinta.tracos.retain(|t| t.apagado_em.is_none());
    Ok(Json(tinta))
}

pub async fn salvar(State(state): State<AppState>, Extension(usuario): Extension<UsuarioAutenticado>, Path(id): Path<String>, Json(payload): Json<SalvarTinta>) -> AppResult<Json<serde_json::Value>> {
    let rel = caminho_por_id(&state, &usuario.0, &id).await?;
    validar(&payload)?;
    let dir = anexos_dir(&state, &id, &rel);
    let _guarda = TRAVA.lock().await;
    let atual = ler(&dir).unwrap_or_else(|_| Tinta::vazia());
    if payload.revisao_base != atual.revisao {
        return Err(AppError::new(ErrorCode::Conflict).with_message(format!("A tinta desta Nota mudou em outro lugar (revisão {}). Recarregue antes de salvar.", atual.revisao)));
    }

    let limite_lapide = Utc::now() - Duration::days(DIAS_LAPIDE);
    let mut tracos = payload.tracos;
    tracos.retain(|t| t.apagado_em.map_or(true, |a| a > limite_lapide));

    if tracos.iter().all(|t| t.apagado_em.is_some()) {
        // Sem traço ativo: a Nota deixa de ser convertida (largura fluida, aviso volta).
        for nome in [ARQUIVO_JSON, ARQUIVO_SVG] {
            match std::fs::remove_file(dir.join(nome)) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.into()),
                _ => {}
            }
        }
        // Só remove a pasta se ficou vazia (pode haver outros anexos).
        let _ = std::fs::remove_dir(&dir);
        return Ok(Json(serde_json::json!({ "revisao": 0, "largura_coluna": null })));
    }

    // A largura gravada na 1ª conversão não muda depois: as coordenadas dependem dela.
    let largura = atual.largura_coluna.unwrap_or(payload.largura_coluna);
    let nova = Tinta { versao: VERSAO, revisao: atual.revisao + 1, largura_coluna: Some(largura), tracos };
    std::fs::create_dir_all(&dir)?;
    gravar_atomico(&dir.join(ARQUIVO_JSON), serde_json::to_string(&nova).map_err(anyhow::Error::from)?.as_bytes())?;
    gravar_atomico(&dir.join(ARQUIVO_SVG), montar_svg(largura, &nova.tracos).as_bytes())?;
    Ok(Json(serde_json::json!({ "revisao": nova.revisao, "largura_coluna": largura })))
}

#[cfg(test)]
mod testes {
    use super::*;

    fn traco(id: &str) -> Traco {
        Traco { id: id.into(), ferramenta: Ferramenta::Caneta, cor: "auto".into(), espessura: 2.0, pontos: vec![Ponto { x: 10.0, y: 20.0, pressao: 0.5 }], d: "M10 20 L12 22 Z".into(), criado_em: Utc::now(), apagado_em: None }
    }

    fn payload(tracos: Vec<Traco>) -> SalvarTinta {
        SalvarTinta { revisao_base: 0, largura_coluna: 760, tracos }
    }

    #[test]
    fn d_aceita_so_comandos_de_path() {
        assert!(d_valido("M1.5 2 C3,4 5,6 7,8 Q1 2 3 4 Z"));
        for ruim in ["", "M0 0\"/><script>alert(1)</script>", "M0 0 onload=x", "M0 0 e5", "M0 0 <"] {
            assert!(!d_valido(ruim), "{ruim}");
        }
    }

    #[test]
    fn cor_aceita_auto_ou_hex() {
        assert!(cor_valida("auto") && cor_valida("#A0b1C2"));
        for ruim in ["red", "#fff", "#12345g", "url(#x)", "#1234567"] {
            assert!(!cor_valida(ruim), "{ruim}");
        }
    }

    #[test]
    fn valida_ids_repetidos_pontos_e_faixas() {
        assert!(validar(&payload(vec![traco("a"), traco("b")])).is_ok());
        assert!(validar(&payload(vec![traco("a"), traco("a")])).is_err(), "id repetido");
        let mut t = traco("a");
        t.pontos = vec![];
        assert!(validar(&payload(vec![t])).is_err(), "sem pontos");
        let mut t = traco("a");
        t.pontos[0].pressao = 2.0;
        assert!(validar(&payload(vec![t])).is_err(), "pressão > 1");
        let mut t = traco("a");
        t.pontos[0].x = f64::NAN;
        assert!(validar(&payload(vec![t])).is_err(), "NaN");
        let mut t = traco("a");
        t.espessura = 100.0;
        assert!(validar(&payload(vec![t])).is_err(), "espessura");
        let mut t = traco("a");
        t.id = "../x".into();
        assert!(validar(&payload(vec![t])).is_err(), "id com caminho");
        let mut t = traco("a");
        t.pontos = vec![Ponto { x: 1.0, y: 1.0, pressao: 0.5 }; MAX_PONTOS_TRACO + 1];
        assert!(validar(&payload(vec![t])).is_err(), "pontos demais");
        let mut p = payload(vec![traco("a")]);
        p.largura_coluna = 10;
        assert!(validar(&p).is_err(), "largura");
    }

    #[test]
    fn svg_omite_lapides_e_resolve_auto() {
        let mut apagado = traco("b");
        apagado.apagado_em = Some(Utc::now());
        apagado.d = "M99 99 Z".into();
        let mut marca = traco("c");
        marca.ferramenta = Ferramenta::MarcaTexto;
        marca.cor = "#ffd400".into();
        let svg = montar_svg(760, &[traco("a"), apagado, marca]);
        assert!(svg.contains("fill=\"#1f2937\""), "{svg}");
        assert!(svg.contains("stroke=\"#ffd400\"") && svg.contains("stroke-opacity"), "{svg}");
        assert!(!svg.contains("M99 99"), "lápide fica fora do SVG");
        assert!(svg.starts_with("<svg") && svg.contains("viewBox=\"0 0 760 "));
    }
}
