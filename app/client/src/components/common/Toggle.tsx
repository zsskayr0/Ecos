interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}

/** Toggle — sem ripple (regra 1): trilho com borda, para não sumir no tema claro; cor da marca quando ligado. */
export function Toggle({ checked, onChange, disabled, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 overflow-hidden rounded-full border transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan ${
        checked ? "border-cyan bg-cyan" : "border-border bg-surface-3"
      } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
    >
      <span
        aria-hidden
        className={`absolute left-[3px] top-[3px] h-5 w-5 rounded-full shadow-sm transition-[transform,background-color] duration-200 ease-out ${
          checked ? "translate-x-5 bg-white" : "translate-x-0 bg-text-muted"
        }`}
      />
    </button>
  );
}
