//! Regras de nome de usuário e de senha, compartilhadas pelo `ecos-app` (cadastro e recuperação) e pelo Cofre
//! (ativação). Seguem OWASP ASVS v4 §2.1 e NIST SP 800-63B: o tamanho é o que mais pesa, a lista de senhas comuns
//! barra o óbvio, e nada é truncado. O nome de usuário é também o nome da pasta da pessoa em disco e do Cofre
//! dela, então é curto, ASCII e sem nada que um sistema de arquivos trate de forma especial.
//!
//! Só valem para **criar** credenciais: o login e o desbloqueio do Cofre nunca as aplicam, para não trancar
//! para fora quem já tem uma senha de antes.

pub const USUARIO_MIN: usize = 3;
pub const USUARIO_MAX: usize = 32;
pub const SENHA_MIN: usize = 12;
/// Teto contra abuso (o Argon2 custa memória e tempo por tentativa), bem acima do que uma pessoa digita.
pub const SENHA_MAX: usize = 128;

/// Nomes que nunca podem ser de uma pessoa: contas "de sistema" (evita se passar por elas) e nomes que já
/// significam algo em disco ou na API. Comparação sem diferenciar maiúsculas.
const USUARIOS_RESERVADOS: &[&str] = &[
    "admin", "administrator", "administrador", "root", "system", "sistema", "sys", "ecos", "vault", "cofre", "api",
    "me", "eu", "null", "undefined", "none", "anonymous", "anonimo", "guest", "convidado", "support", "suporte",
    "www", "app", "test", "teste", "pessoal", "equipe", "notas", "tarefas", "eventos", "src", "media", "lixeira",
    "usuarios", "backup", "backups", "config",
];

/// Nomes de dispositivo do Windows: como nome de pasta, `con`, `nul`, `com1`... não funcionam nesse sistema.
const DISPOSITIVOS_WINDOWS: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9", "lpt1", "lpt2",
    "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// Senhas e palavras que aparecem em todas as listas de vazamentos (e variações em português). A regra olha a senha
/// inteira e também só as letras dela, então `Senha@123456789` cai em "senha".
const SENHAS_COMUNS: &[&str] = &[
    "password", "passw0rd", "senha", "senhasenha", "qwerty", "qwertyuiop", "qwertyuiopasdfghjkl", "asdfgh", "asdfghjkl", "zxcvbn",
    "zxcvbnm", "abcdef", "abcdefgh", "abcdefghijkl", "abc", "letmein", "welcome", "bemvindo", "admin", "administrador", "root", "master",
    "login", "iloveyou", "teamo", "eutequero", "meuamor", "amor", "brasil", "brasileiro", "flamengo", "corinthians", "palmeiras",
    "vasco", "gremio", "santos", "futebol", "dragon", "monkey", "football", "baseball", "superman", "batman", "sunshine",
    "princess", "shadow", "michael", "jessica", "trustno", "changeme", "mudar", "mudar123", "trocar", "secret", "segredo",
    "ecos", "ecosapp", "cofre", "vault", "abcd", "abcdefghijklmnop", "teste", "testando", "senhaforte", "minhasenha",
    "minhasenhaforte", "senhasecreta", "novasenha", "usuario", "computador", "internet", "google", "facebook", "whatsapp",
    "iphone", "samsung", "gabriel", "matheus", "lucas", "felipe", "rafael", "guilherme", "diogo", "thaty",
];

/// Valida um nome de usuário novo. `Err` traz a mensagem para mostrar à pessoa.
pub fn validar_nome_usuario(nome: &str) -> Result<(), String> {
    let n = nome.chars().count();
    if !(USUARIO_MIN..=USUARIO_MAX).contains(&n) {
        return Err(format!("deve ter de {USUARIO_MIN} a {USUARIO_MAX} caracteres"));
    }
    if !nome.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')) {
        return Err("use só letras (sem acento), números, ponto, hífen e sublinhado, sem espaços".into());
    }
    let (primeiro, ultimo) = (nome.chars().next().unwrap_or(' '), nome.chars().last().unwrap_or(' '));
    if !primeiro.is_ascii_alphanumeric() || !ultimo.is_ascii_alphanumeric() {
        return Err("deve começar e terminar com letra ou número".into());
    }
    let mut anterior_separador = false;
    for c in nome.chars() {
        let separador = !c.is_ascii_alphanumeric();
        if separador && anterior_separador {
            return Err("não pode ter dois separadores seguidos (.., .-, __ ...)".into());
        }
        anterior_separador = separador;
    }
    let minusculo = nome.to_ascii_lowercase();
    if USUARIOS_RESERVADOS.contains(&minusculo.as_str()) || DISPOSITIVOS_WINDOWS.contains(&minusculo.as_str()) {
        return Err("este nome é reservado, escolha outro".into());
    }
    Ok(())
}

fn so_letras_minusculas(s: &str) -> String {
    s.chars().filter(|c| c.is_alphabetic()).flat_map(char::to_lowercase).collect()
}

/// A senha inteira é uma sequência (`abcdefghijkl`, `123456789012`, `9876543210987`)?
fn e_sequencia(s: &str) -> bool {
    let cs: Vec<u32> = s.chars().map(|c| c as u32).collect();
    if cs.len() > 1 && (cs.windows(2).all(|w| w[1] == w[0] + 1) || cs.windows(2).all(|w| w[0] == w[1] + 1)) {
        return true;
    }
    // Dígitos dão a volta: 1234567890123 e 9876543210987 também são sequências.
    if s.chars().all(|c| c.is_ascii_digit()) {
        let d: Vec<u32> = s.chars().filter_map(|c| c.to_digit(10)).collect();
        return d.windows(2).all(|w| w[1] == (w[0] + 1) % 10) || d.windows(2).all(|w| w[0] == (w[1] + 1) % 10);
    }
    false
}

/// Valida uma senha nova (conta ou Cofre). `nome_usuario`, quando conhecido, não pode aparecer dentro dela.
pub fn validar_senha(senha: &str, nome_usuario: Option<&str>) -> Result<(), String> {
    let n = senha.chars().count();
    if n < SENHA_MIN {
        return Err(format!("deve ter ao menos {SENHA_MIN} caracteres"));
    }
    if n > SENHA_MAX {
        return Err(format!("deve ter no máximo {SENHA_MAX} caracteres"));
    }
    if senha.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("não pode conter espaços nem caracteres de controle".into());
    }
    let distintos = senha.chars().collect::<std::collections::HashSet<_>>().len();
    if distintos < 5 || e_sequencia(senha) {
        return Err("é previsível demais (repetição ou sequência); misture caracteres diferentes".into());
    }
    if senha.chars().all(|c| c.is_ascii_digit()) && n < 16 {
        return Err("só números é fraco demais; misture letras e símbolos (ou use 16 dígitos ou mais)".into());
    }
    let letras = so_letras_minusculas(senha);
    let alnum: String = senha.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect();
    if SENHAS_COMUNS.contains(&alnum.as_str()) || SENHAS_COMUNS.contains(&letras.as_str()) {
        return Err("é uma senha comum demais; escolha outra".into());
    }
    if let Some(usuario) = nome_usuario.map(str::to_lowercase).filter(|u| u.chars().count() >= 3) {
        if senha.to_lowercase().contains(&usuario) {
            return Err("não pode conter o seu nome de usuário".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nomes_de_usuario_validos_e_invalidos() {
        for ok in ["diogo", "Zsskayr0", "thaty.silva", "ana-maria_2", "a1b", "João".replace('ã', "a").as_str()] {
            assert_eq!(validar_nome_usuario(ok), Ok(()), "{ok}");
        }
        for ruim in [
            "ab", "", &"a".repeat(33), "com espaço", "joão", "a/b", "..", "a\\b", "ana!", ".ana", "ana.", "-ana", "ana_", "a..b", "a._b",
            "Admin", "ROOT", "Pessoal", "src", "NUL", "com1", "lixeira", "usuarios",
        ] {
            assert!(validar_nome_usuario(ruim).is_err(), "{ruim:?} devia ser recusado");
        }
    }

    #[test]
    fn senhas_boas_passam_e_ruins_sao_recusadas_com_motivo() {
        for ok in ["cavalo-Bateria-Grampo-9", "t7#Vq2!mLp0Zx", "correta.bateria.grampo", "Zk9$wQ2#pL7@"] {
            assert_eq!(validar_senha(ok, Some("diogo")), Ok(()), "{ok}");
        }
        let casos: &[(&str, Option<&str>)] = &[
            ("curta1!", None),                       // curta
            ("com espaco no meio 123", None),        // espaço
            ("tab\tno-meio-da-senha", None),         // controle
            ("aaaaaaaaaaaaaaaa", None),              // repetição
            ("123456789012", None),                  // sequência
            ("abcdefghijkl", None),                  // sequência
            ("210987654321", None),                  // sequência decrescente
            ("Senha@123456789", None),               // letras = "senha"
            ("Password123456!", None),               // letras = "password"
            ("qwertyuiopasdfghjkl", None),           // comum
            ("MinhaSenhaForte", None),               // comum
            ("xdiogoX-9182-zz", Some("Diogo")),      // contém o usuário
        ];
        for (s, u) in casos {
            assert!(validar_senha(s, *u).is_err(), "{s:?} devia ser recusada");
        }
        assert!(validar_senha(&"a1B".repeat(50), None).is_err(), "acima do teto");
        assert!(validar_senha("nome-de-usuario-curto-ab", Some("ab")).is_ok(), "usuário curto demais não vira regra");
    }
}
