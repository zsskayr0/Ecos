//! Persistência em disco de Eventos: um `.md` por evento em `<espaço>/Eventos/`
//! e as categorias do espaço em `<espaço>/Eventos/_categorias.yaml`.

use ecos_core::types::CategoriaEvento;
use std::path::Path;

pub const DIR: &str = "Eventos";
pub const ARQUIVO_CATEGORIAS: &str = "_categorias.yaml";

/// Categorias do espaço; arquivo ausente ou ilegível = nenhuma (o reindex nunca falha por isso).
pub fn ler_categorias(dir_eventos: &Path) -> Vec<CategoriaEvento> {
    let Ok(texto) = std::fs::read_to_string(dir_eventos.join(ARQUIVO_CATEGORIAS)) else { return Vec::new() };
    serde_yaml::from_str(&texto).unwrap_or_else(|err| {
        tracing::warn!(error = %err, dir = %dir_eventos.display(), "categorias de evento ilegíveis; ignorando");
        Vec::new()
    })
}

/// Gravação atômica (tmp + rename), como nas notas adotadas.
pub fn escrever_categorias(dir_eventos: &Path, categorias: &[CategoriaEvento]) -> std::io::Result<()> {
    std::fs::create_dir_all(dir_eventos)?;
    let yaml = serde_yaml::to_string(categorias).map_err(std::io::Error::other)?;
    let destino = dir_eventos.join(ARQUIVO_CATEGORIAS);
    let tmp = dir_eventos.join(format!("{ARQUIVO_CATEGORIAS}.ecos-tmp"));
    std::fs::write(&tmp, yaml)?;
    std::fs::rename(&tmp, &destino)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn categorias_fazem_roundtrip_e_ausente_e_vazio() {
        let dir = std::env::temp_dir().join(format!("ecos-cat-{}", ecos_core::new_id()));
        assert!(ler_categorias(&dir).is_empty());
        let cats = vec![CategoriaEvento { id: "c1".into(), nome: "Reunião".into(), cor: "#3366ff".into(), icone: None }];
        escrever_categorias(&dir, &cats).unwrap();
        assert_eq!(ler_categorias(&dir), cats);
        std::fs::remove_dir_all(dir).ok();
    }
}
