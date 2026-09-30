"use client";
import { useEffect, useState } from "react";
import { errorMessage } from "./client";

export const POLL_INTERVAL_MS = 2000;
export const POLL_TIMEOUT_MS = 90000;

// One request at a time. Cleanup cancels both the timer and in-flight request.
export function useProcessingPoll<T>({
  active,
  read,
  isProcessing,
  onData,
  formatError = errorMessage,
}: {
  active: boolean;
  read: (signal: AbortSignal) => Promise<T>;
  isProcessing: (data: T) => boolean;
  onData: (data: T) => void;
  formatError?: (error: unknown) => string;
}) {
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
      setTimedOut(true);
    }, POLL_TIMEOUT_MS);
    async function check() {
      try {
        const data = await read(
          AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        );
        if (cancelled) return;
        onData(data);
        if (isProcessing(data)) timer = setTimeout(check, POLL_INTERVAL_MS);
        else clearTimeout(timeout);
      } catch (err) {
        if (cancelled) return;
        clearTimeout(timeout);
        setError(formatError(err));
      }
    }
    timer = setTimeout(check, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(timeout);
      controller.abort();
    };
  }, [active, read, isProcessing, onData, formatError, version]);
  function resume() {
    setError("");
    setTimedOut(false);
    setVersion((value) => value + 1);
  }
  return { error: active ? error : "", timedOut: active && timedOut, resume };
}
