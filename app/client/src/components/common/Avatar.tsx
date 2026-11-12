import { useEffect, useState } from "react";

interface AvatarProps {
  nome: string;
  corFundo?: string;
  tamanho?: number;
  url?: string;
}

/** Initials-based avatar — no stock imagery, optional identity color (Team). */
export function Avatar({ nome, corFundo = "#3E6FA8", tamanho = 36, url }: AvatarProps) {
  const iniciais = nome
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  const [falhou, setFalhou] = useState(false);
  useEffect(() => setFalhou(false), [url]);

  if (url && !falhou) {
    return (
      <img
        src={url}
        alt={nome}
        onError={() => setFalhou(true)}
        width={tamanho}
        height={tamanho}
        className="rounded-full object-cover shrink-0"
        style={{ width: tamanho, height: tamanho, minWidth: tamanho, maxWidth: "none", objectFit: "cover", borderRadius: "50%" }}
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
