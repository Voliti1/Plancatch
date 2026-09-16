"use client";
import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "./client";
export function useResource<T>(loader: () => Promise<T>) {
  const [state, setState] = useState<{
    data?: T;
    error?: string;
    loading: boolean;
  }>({ loading: true });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let active = true;
    loader()
      .then((data) => {
        if (active) setState({ data, loading: false });
      })
      .catch((error) => {
        if (active) setState({ error: errorMessage(error), loading: false });
      });
    return () => {
      active = false;
    };
  }, [loader, version]);
  return { ...state, reload };
}
