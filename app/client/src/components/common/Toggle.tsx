interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}

/** Toggle — no ripple/Material Design (rule 1); a plain stroke, brand color when "on". */
export function Toggle({ checked, onChange, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-pill transition-colors ${
        checked ? "bg-steel-500" : "bg-surface-3"
      } ${disabled ? "opacity-40" : ""}`}
    >
      <span
        className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-transform ${
          checked ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
