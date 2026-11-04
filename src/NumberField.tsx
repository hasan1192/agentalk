import { useEffect, useRef, useState } from "react";

// Keep the editing text separate from the committed number: clearing an input
// must remain possible, while leaving it always commits a bounded value.
export default function NumberField({
  value,
  min,
  max,
  step = 1,
  onChange,
  onValidityChange,
  ...props
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  onValidityChange?: (valid: boolean) => void;
  "aria-label"?: string;
  id?: string;
}) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);
  return (
    <input
      {...props}
      type="number"
      min={min}
      max={max}
      step={step}
      value={text}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(event) => {
        const raw = event.target.value;
        setText(raw);
        const number = Number(raw);
        const valid =
          raw !== "" &&
          Number.isFinite(number) &&
          number >= min &&
          number <= max;
        onValidityChange?.(valid);
        if (valid) onChange(number);
      }}
      onBlur={() => {
        focused.current = false;
        const number = text === "" ? min : Number(text);
        const bounded = Math.max(
          min,
          Math.min(max, Number.isFinite(number) ? number : min),
        );
        setText(String(bounded));
        onValidityChange?.(true);
        if (bounded !== value) onChange(bounded);
      }}
    />
  );
}
