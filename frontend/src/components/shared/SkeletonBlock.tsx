type SkeletonBlockProps = {
  height?: number;
};

export function SkeletonBlock({ height = 96 }: SkeletonBlockProps) {
  return <div className="skeleton-block" style={{ height }} aria-label="loading skeleton" />;
}

