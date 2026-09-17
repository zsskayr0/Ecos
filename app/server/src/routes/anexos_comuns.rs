//! Helpers de anexo compartilhados entre Tarefa e Nota (seção 1.3: "arquivo
//! irmão do `.md` em `_anexos/<id>/`, referenciado no corpo via link
//! Markdown relativo — nunca BLOB em banco, isso é exclusivo do Cofre").

pub const TAMANHO_MAXIMO_BYTES: usize = 120 * 1024 * 1024;
/// Reserva para cabeçalhos e separadores do multipart, além do arquivo.
pub const TAMANHO_MAXIMO_MULTIPART_BYTES: usize = TAMANHO_MAXIMO_BYTES + 1024 * 1024;

pub fn mime_por_extensao(nome_arquivo: &str) -> &'static str {
    match nome_arquivo.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "pdf" => "application/pdf",
        "txt" => "text/plain",
        "md" => "text/markdown",
        "csv" => "text/csv",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "zip" => "application/zip",
        _ => "application/octet-stream",
    }
}
