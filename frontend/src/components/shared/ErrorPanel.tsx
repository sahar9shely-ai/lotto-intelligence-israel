type ErrorPanelProps = {
  title?: string;
  message: string;
};

export function ErrorPanel({ title = "אירעה שגיאה", message }: ErrorPanelProps) {
  return (
    <article className="error-panel" role="alert">
      <h3>{title}</h3>
      <p>{message}</p>
    </article>
  );
}

