interface AvatarProps {
  nome: string;
  corFundo?: string;
  tamanho?: number;
  url?: string;
}

/** Avatar por iniciais — nenhuma imagem de estoque, cor de identidade (Equipe) opcional. */
export function Avatar({ nome, corFundo = "#3E6FA8", tamanho = 36, url }: AvatarProps) {
  const iniciais = nome
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  if (url) {
    return (
      <img
        src={url}
        alt={nome}
        className="rounded-full object-cover shrink-0"
        style={{ width: tamanho, height: tamanho }}
      />
    );
  }

  return (
    <div
      className="flex items-center justify-center rounded-full font-body font-semibold text-white shrink-0"
      style={{ width: tamanho, height: tamanho, backgroundColor: corFundo, fontSize: tamanho * 0.4 }}
    >
      {iniciais || "?"}
    </div>
  );
}
