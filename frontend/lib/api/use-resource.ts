"use client";
import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "./client";
export function useResource<T>(loader: () => Promise<T>) {
  const [state, setState] = useState<{
    data?: T;
    error?: string;
    loading: boolean;
    loader?: () => Promise<T>;
    version?: number;
  }>({ loading: true });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let active = true;
    loader()
      .then((data) => {
        if (active) setState({ data, loading: false, loader, version });
      })
      .catch((error) => {
        if (active) setState({ error: errorMessage(error), loading: false, loader, version });
      });
    return () => {
      active = false;
    };
  }, [loader, version]);
  const current = state.loader === loader && state.version === version;
  return {
    data: current ? state.data : undefined,
    error: current ? state.error : undefined,
    loading: !current || state.loading,
    reload,
  };
}
