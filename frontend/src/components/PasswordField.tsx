import { useId, useState, type InputHTMLAttributes } from "react";

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
};

export function PasswordField({ label, className, id, dir = "ltr", ...props }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const autoId = useId();
  const inputId = id ?? autoId;

  return (
    <label className={className ? `password-field-label ${className}` : "password-field-label"} htmlFor={inputId}>
      {label}
      <span className="password-field">
        <input
          {...props}
          id={inputId}
          dir={dir}
          type={visible ? "text" : "password"}
          className="password-field__input"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
        />
        <button
          type="button"
          className="password-field__toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "הסתרת סיסמה" : "הצגת סיסמה"}
          aria-pressed={visible}
          tabIndex={0}
        >
          {visible ? "הסתר" : "הצג"}
        </button>
      </span>
    </label>
  );
}
