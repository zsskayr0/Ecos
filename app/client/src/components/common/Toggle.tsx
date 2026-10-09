interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}

/** Toggle (dimensionado em `em`: acompanha o tamanho do texto ao redor) — sem ripple (regra 1): trilho com borda, para não sumir no tema claro; cor da marca quando ligado. */
export function Toggle({ checked, onChange, disabled, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[1.4em] w-[2.5em] shrink-0 overflow-hidden rounded-full border transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-steel-400 ${
        checked ? "border-steel-500 bg-steel-500" : "border-border bg-surface-3"
      } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
    >
      <span
        aria-hidden
        className={`absolute left-[0.2em] top-[0.2em] h-[0.8em] w-[0.8em] rounded-full shadow-sm transition-[transform,background-color] duration-200 ease-out ${
          checked ? "translate-x-[1.1em] bg-white" : "translate-x-0 bg-text-muted"
        }`}
      />
    </button>
  );
}
