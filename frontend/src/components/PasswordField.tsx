import { useId, useState, type FocusEvent, type InputHTMLAttributes } from "react";

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
};

/** Extra attributes that stop browsers / password managers from treating admin identity fields as a login. */
export const disableIdentityAutofill: Pick<
  InputHTMLAttributes<HTMLInputElement>,
  "autoComplete" | "autoCorrect" | "autoCapitalize" | "spellCheck"
> = {
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "none",
  spellCheck: false,
};

function supportsCssPasswordMask(): boolean {
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") return false;
  return CSS.supports("-webkit-text-security", "disc") || CSS.supports("text-security", "disc");
}

export function PasswordField({
  label,
  className,
  id,
  dir = "ltr",
  autoComplete,
  onFocus,
  readOnly,
  ...props
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const autoId = useId();
  const inputId = id ?? autoId;
  const complete = autoComplete ?? "new-password";
  const allowPasswordManager = complete === "current-password";
  const useCssMask = !allowPasswordManager && supportsCssPasswordMask();
  const inputType = visible || useCssMask ? "text" : "password";

  function handleFocus(event: FocusEvent<HTMLInputElement>) {
    setUnlocked(true);
    onFocus?.(event);
  }

  return (
    <label className={className ? `password-field-label ${className}` : "password-field-label"} htmlFor={inputId}>
      {label}
      <span className="password-field">
        <input
          {...props}
          id={inputId}
          dir={dir}
          type={inputType}
          className={visible ? "password-field__input" : "password-field__input password-field__input--masked"}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete={complete}
          inputMode="text"
          readOnly={readOnly ?? (!unlocked && !allowPasswordManager)}
          onFocus={handleFocus}
          data-lpignore={allowPasswordManager ? undefined : "true"}
          data-1p-ignore={allowPasswordManager ? undefined : "true"}
          data-bwignore={allowPasswordManager ? undefined : "true"}
          data-form-type={allowPasswordManager ? undefined : "other"}
        />
        <button
          type="button"
          className="password-field__toggle"
          onClick={() => setVisible((value) => !value)}
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
