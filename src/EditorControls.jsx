import { useEffect, useRef, useState } from "react";

const clamp = (n, a, b) => Math.min(b, Math.max(a, Number(n) || 0));

export function Button({ Icon, label, children, className = "", ...props }) {
  return (
    <button type="button" className={`button ${className}`} {...props}>
      {Icon && <Icon size={16} />}
      {children || label}
    </button>
  );
}
export function IconButton({ Icon, label, className = "", ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`icon-button ${className}`}
      {...props}
    >
      <Icon size={17} />
    </button>
  );
}
export function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 3600,
  step = 0.1,
  suffix = "秒",
  disabled,
  precision = 3,
  nonFiniteDisplay = "—",
}) {
  const formatted = Number.isFinite(Number(value)) ? String(Number(Number(value).toFixed(precision))) : nonFiniteDisplay;
  const [draft, setDraft] = useState(formatted);
  const cancelBlur = useRef(false);
  const focused = useRef(false);
  const edited = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(formatted);
  }, [formatted]);
  function commit() {
    focused.current = false;
    if (cancelBlur.current) {
      cancelBlur.current = false;
      setDraft(formatted);
      return;
    }
    if (!edited.current) { setDraft(formatted); return; }
    const numeric = draft.trim() === "" ? NaN : Number(draft);
    if (!Number.isFinite(numeric)) {
      setDraft(formatted);
      return;
    }
    const next = clamp(numeric, min, max);
    setDraft(String(Number(next.toFixed(precision))));
    if (next !== Number(value)) onChange(next);
  }
  return (
    <label className="field">
      <span>{label}</span>
      <div className="number-box">
        <input
          aria-label={label}
          type="text"
          inputMode="decimal"
          role="spinbutton"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={Number.isFinite(Number(value)) ? Number(value) : undefined}
          aria-valuetext={Number.isFinite(Number(value)) ? undefined : nonFiniteDisplay}
          title="完整数值即时生效；Enter 确认，Esc 恢复已提交值"
          value={draft}
          disabled={disabled}
          onFocus={() => { focused.current = true; edited.current = false; }}
          onChange={e => {
            edited.current = true;
            const text = e.target.value;
            setDraft(text);
            if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return;
            const numeric = Number(text);
            if (!Number.isFinite(numeric)) return;
            const next = clamp(numeric, min, max);
            if (next !== Number(value)) onChange(next);
          }}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              cancelBlur.current = true;
              setDraft(formatted);
              e.currentTarget.blur();
            } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              edited.current = true;
              const numeric = draft.trim() === "" ? Number(value) : Number(draft);
              const current = Number.isFinite(numeric) ? numeric : Number.isFinite(Number(value)) ? Number(value) : min;
              const next = clamp(Number((current + (e.key === "ArrowUp" ? step : -step)).toFixed(precision)), min, max);
              setDraft(String(next));
              if (next !== Number(value)) onChange(next);
            }
          }}
        />
        <small>{suffix}</small>
      </div>
    </label>
  );
}
