import { useId, useState, type InputHTMLAttributes } from "react";

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
};

export function PasswordField({ label, className, id, ...props }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const autoId = useId();
  const inputId = id ?? autoId;

  return (
    <label className={className} htmlFor={inputId}>
      {label}
      <span className="password-field">
        <input
          {...props}
          id={inputId}
          type={visible ? "text" : "password"}
          className="password-field__input"
        />
        <button
          type="button"
          className="password-field__toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "הסתרת סיסמה" : "הצגת סיסמה"}
          aria-pressed={visible}
        >
          {visible ? "הסתר" : "הצג"}
        </button>
      </span>
    </label>
  );
}
