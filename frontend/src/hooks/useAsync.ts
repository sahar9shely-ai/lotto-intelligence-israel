import { useCallback, useEffect, useRef, useState } from "react";

export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0);
  const hasDataRef = useRef(false);

  useEffect(() => {
    let alive = true;
    const soft = hasDataRef.current;
    if (soft) setRefreshing(true);
    else setLoading(true);
    setError(null);
    loader()
      .then((result) => {
        if (!alive) return;
        setData(result);
        hasDataRef.current = true;
      })
      .catch((err: Error) => {
        if (!alive) return;
        setError(err.message || "שגיאה בטעינה");
        if (!hasDataRef.current) setData(null);
      })
      .finally(() => {
        if (!alive) return;
        setLoading(false);
        setRefreshing(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return {
    data,
    error,
    loading,
    refreshing,
    reload,
    setData,
  };
}
