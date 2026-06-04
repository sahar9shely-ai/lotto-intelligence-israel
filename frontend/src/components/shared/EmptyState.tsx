type EmptyStateProps = {
  title: string;
  description?: string;
};

export function EmptyState({ title, description = "המסך יוטמע בשלב הבא." }: EmptyStateProps) {
  return (
    <article className="empty-state">
      <h3>{title}</h3>
      <p>{description}</p>
    </article>
  );
}

type PlaceholderPageProps = {
  title: string;
};

export function PlaceholderPage({ title }: PlaceholderPageProps) {
  return <EmptyState title={title} description="Placeholder foundation page." />;
}

