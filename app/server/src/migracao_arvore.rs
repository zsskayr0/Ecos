//! Passo 5 do ADR da árvore única: cada espaço deixa de ter `Notas/`, `Tarefas/`, `Eventos/`, `Series/` e
//! `src/Media/` e passa a ser **uma árvore só**, com o que é do sistema em `.ecos_app/`:
//!
//! - `Eventos/` → `.ecos_app/Eventos/`, `Series/` → `.ecos_app/Series/`, `src/Media/` → `.ecos_app/Media/`
//!   (os Markdown continuam citando `src/Media/...`: o prefixo é resolvido no servidor);
//! - o conteúdo de `Notas/` e `Tarefas/` vai para a raiz do espaço. Pastas de mesmo nome se fundem; arquivo de mesmo
//!   nome ganha ` (2)` e entra no relatório;
//! - tarefa sem `tipo` ganha `tipo: tarefa` antes de sair de `Tarefas/` (fora dela, só o conteúdo diz o tipo);
//! - a aparência das pastas (`.ecos-pastas.json`) das duas árvores vira uma só; a de `Notas/` vence;
//! - registros da lixeira e do desfazer de renomeação passam a apontar para os caminhos novos.
//!
//! Roda no boot, antes do reindex. É idempotente (espaço migrado tem `.ecos_app/layout`) e retomável: se parar no
//! meio, a próxima execução continua de onde estava. Nada é apagado: só pastas vazias do layout antigo somem.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::espacos::{nome_interno, APP_DIR, ARVORES_LEGADAS, LAYOUT_ATUAL, MARCA_LAYOUT};

const META_PASTAS: &str = ".ecos-pastas.json";

#[derive(Debug, Default, Serialize)]
pub struct RelatorioEspaco {
    pub pasta: String,
    /// Arquivos movidos (contando os de dentro das pastas movidas inteiras).
    pub arquivos: usize,
    /// (de, para) relativos ao espaço, quando o nome já existia no destino.
    pub renomeados: Vec<(String, String)>,
    pub tarefas_com_tipo: usize,
}

#[derive(Debug, Default, Serialize)]
pub struct Relatorio {
    pub espacos: Vec<RelatorioEspaco>,
    pub registros_atualizados: usize,
}

fn contar_arquivos(p: &Path) -> usize {
    if p.is_file() {
        return 1;
    }
    walkdir::WalkDir::new(p).into_iter().filter_map(Result::ok).filter(|e| e.file_type().is_file()).count()
}

/// `nome (2).ext` livre em `dir`.
fn livre(dir: &Path, nome: &str) -> PathBuf {
    let (base, ext) = match nome.rsplit_once('.') {
        Some((b, e)) if !b.is_empty() && !e.is_empty() => (b.to_string(), format!(".{e}")),
        _ => (nome.to_string(), String::new()),
    };
    let mut n = 2u32;
    loop {
        let candidato = dir.join(format!("{base} ({n}){ext}"));
        if !candidato.exists() {
            return candidato;
        }
        n += 1;
    }
}

fn rel(espaco: &Path, p: &Path) -> String {
    p.strip_prefix(espaco).unwrap_or(p).to_string_lossy().replace('\\', "/")
}

/// Move o conteúdo de `origem` para dentro de `destino`, fundindo pastas de mesmo nome. Arquivo que colide ganha
/// ` (2)`. `origem` some se ficar vazia. `pular` = nomes na raiz de `origem` que não são movidos aqui.
fn mesclar(espaco: &Path, origem: &Path, destino: &Path, pular: &[&str], r: &mut RelatorioEspaco, simular: bool) -> std::io::Result<()> {
    if !origem.is_dir() {
        return Ok(());
    }
    if !simular {
        std::fs::create_dir_all(destino)?;
    }
    let mut entradas: Vec<_> = std::fs::read_dir(origem)?.flatten().collect();
    entradas.sort_by_key(|e| e.file_name());
    for entrada in entradas {
        let nome = entrada.file_name().to_string_lossy().to_string();
        if pular.contains(&nome.as_str()) {
            continue;
        }
        let de = entrada.path();
        let para = destino.join(&nome);
        let e_dir = entrada.file_type()?.is_dir();
        if !para.exists() {
            r.arquivos += contar_arquivos(&de);
            if !simular {
                std::fs::rename(&de, &para)?;
            }
        } else if e_dir && para.is_dir() {
            mesclar(espaco, &de, &para, &[], r, simular)?;
        } else {
            let novo = livre(destino, &nome);
            r.arquivos += contar_arquivos(&de);
            r.renomeados.push((rel(espaco, &de), rel(espaco, &novo)));
            if !simular {
                std::fs::rename(&de, &novo)?;
            }
        }
    }
    if !simular {
        // Só some se ficou vazia (algo que falhou ao mover continua lá).
        let _ = std::fs::remove_dir(origem);
    }
    Ok(())
}

/// Insere `tipo: tarefa` no front-matter de quem não declara tipo; sem front-matter, cria um com só o tipo
/// (continua uma tarefa inválida visível, como era em `Tarefas/`, em vez de virar nota adotada).
fn com_tipo_tarefa(texto: &str) -> Option<String> {
    let (abertura, resto) = if let Some(r) = texto.strip_prefix("---\r\n") {
        ("---\r\n", r)
    } else if let Some(r) = texto.strip_prefix("---\n") {
        ("---\n", r)
    } else {
        return Some(format!("---\ntipo: tarefa\n---\n{texto}"));
    };
    let fim = resto.find("\n---").map(|i| i + 1).unwrap_or(resto.len());
    let bloco = &resto[..fim];
    if bloco.lines().any(|l| l.trim_start().starts_with("tipo:") && !l.starts_with(' ') && !l.starts_with('\t')) {
        return None;
    }
    let quebra = if abertura.ends_with("\r\n") { "\r\n" } else { "\n" };
    Some(format!("{abertura}tipo: tarefa{quebra}{resto}"))
}

fn marcar_tarefas(tarefas: &Path, r: &mut RelatorioEspaco, simular: bool) -> std::io::Result<()> {
    if !tarefas.is_dir() {
        return Ok(());
    }
    let arquivos: Vec<PathBuf> = walkdir::WalkDir::new(tarefas)
        .into_iter()
        .filter_entry(|e| e.depth() == 0 || !nome_interno(&e.file_name().to_string_lossy()))
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file() && e.path().extension().is_some_and(|x| x == "md"))
        .map(|e| e.into_path())
        .collect();
    for arquivo in arquivos {
        let Ok(texto) = std::fs::read_to_string(&arquivo) else { continue };
        if let Some(novo) = com_tipo_tarefa(&texto) {
            r.tarefas_com_tipo += 1;
            if !simular {
                let tmp = arquivo.with_extension("md.ecos-tmp");
                std::fs::write(&tmp, novo)?;
                std::fs::rename(&tmp, &arquivo)?;
            }
        }
    }
    Ok(())
}

/// Junta a aparência das pastas das duas árvores na raiz do espaço (a de `Notas/` vence, como na tela de Notas).
fn juntar_meta(dir: &Path, simular: bool) -> std::io::Result<()> {
    let ler = |p: &Path| -> serde_json::Map<String, serde_json::Value> {
        std::fs::read(p).ok().and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok()).and_then(|v| v.as_object().cloned()).unwrap_or_default()
    };
    let mut meta = ler(&dir.join(META_PASTAS));
    let mut achou = false;
    for arvore in ["Tarefas", "Notas"] {
        let arquivo = dir.join(arvore).join(META_PASTAS);
        if arquivo.is_file() {
            achou = true;
            meta.extend(ler(&arquivo));
            if !simular {
                std::fs::remove_file(&arquivo)?;
            }
        }
    }
    if achou && !simular {
        std::fs::write(dir.join(META_PASTAS), serde_json::to_vec_pretty(&serde_json::Value::Object(meta)).unwrap_or_default())?;
    }
    Ok(())
}

fn ja_migrado(dir: &Path) -> bool {
    std::fs::read_to_string(dir.join(APP_DIR).join(MARCA_LAYOUT)).is_ok_and(|v| v.trim() == LAYOUT_ATUAL)
}

fn migrar_espaco(dir: &Path, simular: bool) -> std::io::Result<RelatorioEspaco> {
    let mut r = RelatorioEspaco { pasta: dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), ..Default::default() };
    let app = dir.join(APP_DIR);
    // 1) O que é do sistema vai para `.ecos_app/`.
    for (antigo, novo) in [("Eventos", "Eventos"), ("Series", "Series")] {
        mesclar(dir, &dir.join(antigo), &app.join(novo), &[], &mut r, simular)?;
    }
    mesclar(dir, &dir.join("src").join("Media"), &app.join("Media"), &[], &mut r, simular)?;
    if !simular {
        let _ = std::fs::remove_dir(dir.join("src"));
    }
    // 2) Tarefas declaram o tipo enquanto ainda estão em `Tarefas/`.
    marcar_tarefas(&dir.join("Tarefas"), &mut r, simular)?;
    juntar_meta(dir, simular)?;
    // 3) Notas e Tarefas para a raiz do espaço.
    for arvore in ARVORES_LEGADAS {
        mesclar(dir, &dir.join(arvore), dir, &[META_PASTAS], &mut r, simular)?;
    }
    if !simular {
        std::fs::create_dir_all(&app)?;
        std::fs::write(app.join(MARCA_LAYOUT), LAYOUT_ATUAL)?;
    }
    Ok(r)
}

/// Converte caminhos (relativos à raiz das notas) dos espaços migrados em arquivos JSON de registro.
fn atualizar_registros(notes_root: &Path, migrados: &BTreeSet<String>, simular: bool) -> usize {
    let converter = |c: &str| -> Option<String> {
        let topo = c.split('/').next()?;
        if !migrados.contains(topo) {
            return None;
        }
        let novo = crate::espacos::caminho_completo_no_layout_atual(c);
        (novo != c).then_some(novo)
    };
    // (pasta de registros, campos de texto, campos de lista de textos, lista de objetos com `caminho`)
    let alvos: [(&str, &[&str], &[&str], &[&str]); 3] = [
        (".ecos/lixeira/documentos", &["anexos"], &[], &[]),
        (".ecos/lixeira/arquivos", &[], &["partes"], &[]),
        (".ecos/renomeacoes", &[], &[], &["arquivos"]),
    ];
    let mut total = 0;
    for (pasta, textos, listas, objetos) in alvos {
        let Ok(entradas) = std::fs::read_dir(notes_root.join(pasta)) else { continue };
        for entrada in entradas.flatten() {
            let arquivo = entrada.path().join("registro.json");
            let Some(mut v) = std::fs::read(&arquivo).ok().and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok()) else { continue };
            let mut mudou = false;
            let mut trocar = |campo: &mut serde_json::Value| {
                if let Some(novo) = campo.as_str().and_then(|c| converter(c)) {
                    *campo = serde_json::Value::String(novo);
                    mudou = true;
                }
            };
            // Lixeira de documentos: `item.caminho_original` (o item) e `anexos`.
            if let Some(c) = v.pointer_mut("/item/caminho_original") {
                trocar(c);
            }
            for campo in textos {
                if let Some(c) = v.get_mut(*campo) {
                    trocar(c);
                }
            }
            for campo in listas {
                if let Some(lista) = v.get_mut(*campo).and_then(|l| l.as_array_mut()) {
                    lista.iter_mut().for_each(&mut trocar);
                }
            }
            for campo in objetos {
                if let Some(lista) = v.get_mut(*campo).and_then(|l| l.as_array_mut()) {
                    for o in lista {
                        if let Some(c) = o.get_mut("caminho") {
                            trocar(c);
                        }
                    }
                }
            }
            if mudou {
                total += 1;
                if !simular {
                    let _ = std::fs::write(&arquivo, serde_json::to_vec(&v).unwrap_or_default());
                }
            }
        }
    }
    total
}

/// Migra todos os espaços que ainda estão no layout antigo. Com `simular`, só calcula o relatório.
pub fn migrar(notes_root: &Path, simular: bool) -> std::io::Result<Relatorio> {
    let mut relatorio = Relatorio::default();
    let mut migrados = BTreeSet::new();
    for (_, dir) in crate::espacos::listar(notes_root) {
        if ja_migrado(&dir) {
            continue;
        }
        let r = migrar_espaco(&dir, simular)?;
        migrados.insert(r.pasta.clone());
        relatorio.espacos.push(r);
    }
    relatorio.registros_atualizados = atualizar_registros(notes_root, &migrados, simular);
    Ok(relatorio)
}

/// No boot: migra, registra no log e guarda o relatório em `.ecos/`.
pub fn migrar_no_boot(notes_root: &Path) -> anyhow::Result<()> {
    let relatorio = migrar(notes_root, false)?;
    if relatorio.espacos.is_empty() {
        return Ok(());
    }
    for e in &relatorio.espacos {
        tracing::info!(espaco = %e.pasta, arquivos = e.arquivos, renomeados = e.renomeados.len(), tarefas_com_tipo = e.tarefas_com_tipo, "espaço migrado para a árvore única");
        for (de, para) in &e.renomeados {
            tracing::warn!(espaco = %e.pasta, de = %de, para = %para, "nome repetido na árvore única: arquivo renomeado");
        }
    }
    let destino = notes_root.join(".ecos").join(format!("migracao-arvore-unica-{}.json", chrono::Utc::now().format("%Y%m%d-%H%M%S")));
    if let Some(p) = destino.parent() {
        std::fs::create_dir_all(p)?;
    }
    std::fs::write(&destino, serde_json::to_vec_pretty(&relatorio)?)?;
    tracing::info!(relatorio = %destino.display(), registros = relatorio.registros_atualizados, "migração para a árvore única concluída");
    Ok(())
}

#[cfg(test)]
mod testes {
    use super::*;

    fn escrever(p: &Path, conteudo: &str) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, conteudo).unwrap();
    }

    #[test]
    fn tipo_tarefa_entra_so_quando_falta() {
        assert_eq!(com_tipo_tarefa("---\nid: T1\nstatus: pendente\n---\ncorpo").unwrap(), "---\ntipo: tarefa\nid: T1\nstatus: pendente\n---\ncorpo");
        assert!(com_tipo_tarefa("---\nid: T1\ntipo: tarefa\n---\n").is_none());
        assert_eq!(com_tipo_tarefa("só texto").unwrap(), "---\ntipo: tarefa\n---\nsó texto");
        // `tipo` aninhado (de outra chave) não conta como o tipo do arquivo.
        assert!(com_tipo_tarefa("---\nid: T1\nplugin:\n  tipo: x\n---\n").unwrap().contains("\ntipo: tarefa\n"));
    }

    #[test]
    fn espaco_vira_arvore_unica_sem_perder_nada() {
        let raiz = std::env::temp_dir().join(format!("ecos-migracao-{}", ecos_core::new_id()));
        let esp = raiz.join("diogo");
        escrever(&esp.join(".espaco"), "pessoal:U1");
        escrever(&esp.join("Notas/Trabalho/note-Plano.md"), "---\nid: N1\ntitulo: Plano\n---\n");
        escrever(&esp.join("Notas/Trabalho/_anexos/N1/foto.png"), "png");
        escrever(&esp.join("Notas/Igual.md"), "nota");
        escrever(&esp.join("Notas/.ecos-pastas.json"), r#"{"Trabalho":{"cor":"azul"}}"#);
        escrever(&esp.join("Tarefas/Trabalho/task-Entregar.md"), "---\nid: T1\ntitulo: Entregar\nstatus: pendente\n---\n");
        escrever(&esp.join("Tarefas/Igual.md"), "---\nid: T2\n---\n");
        escrever(&esp.join("Tarefas/.ecos-pastas.json"), r#"{"Trabalho":{"cor":"verde"},"Casa":{"cor":"rosa"}}"#);
        escrever(&esp.join("Eventos/ev.md"), "evento");
        escrever(&esp.join("Series/s.json"), "{}");
        escrever(&esp.join("src/Media/2026-09/x.png"), "png");
        escrever(&raiz.join(".ecos/lixeira/documentos/documento-1/registro.json"), r#"{"item":{"caminho_original":"diogo/Notas/Velha.md"},"anexos":"diogo/Notas/_anexos/N9"}"#);

        let simulado = migrar(&raiz, true).unwrap();
        assert_eq!(simulado.espacos[0].arquivos, 8, "{simulado:?}");
        assert!(esp.join("Notas/Igual.md").is_file(), "simular não move nada");

        let r = migrar(&raiz, false).unwrap();
        let e = &r.espacos[0];
        assert_eq!((e.arquivos, e.tarefas_com_tipo, r.registros_atualizados), (8, 2, 1), "{r:?}");
        assert_eq!(e.renomeados, vec![("Tarefas/Igual.md".to_string(), "Igual (2).md".to_string())]);
        for f in ["Trabalho/note-Plano.md", "Trabalho/_anexos/N1/foto.png", "Trabalho/task-Entregar.md", "Igual.md", "Igual (2).md", ".ecos_app/Eventos/ev.md", ".ecos_app/Series/s.json", ".ecos_app/Media/2026-09/x.png"] {
            assert!(esp.join(f).is_file(), "{f}");
        }
        for velha in ["Notas", "Tarefas", "Eventos", "Series", "src"] {
            assert!(!esp.join(velha).exists(), "{velha} sobrou");
        }
        assert!(std::fs::read_to_string(esp.join("Trabalho/task-Entregar.md")).unwrap().starts_with("---\ntipo: tarefa\n"));
        let meta: serde_json::Value = serde_json::from_slice(&std::fs::read(esp.join(".ecos-pastas.json")).unwrap()).unwrap();
        assert_eq!((meta["Trabalho"]["cor"].as_str(), meta["Casa"]["cor"].as_str()), (Some("azul"), Some("rosa")));
        let reg = std::fs::read_to_string(raiz.join(".ecos/lixeira/documentos/documento-1/registro.json")).unwrap();
        assert!(reg.contains(r#""caminho_original":"diogo/Velha.md""#) && reg.contains(r#""anexos":"diogo/_anexos/N9""#), "{reg}");

        // Idempotente: rodar de novo não faz nada.
        assert!(migrar(&raiz, false).unwrap().espacos.is_empty());
        let _ = std::fs::remove_dir_all(&raiz);
    }
}
