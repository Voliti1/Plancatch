"use client";
import { useSyncExternalStore } from "react";
const subscribe = () => () => {};
// Forms stay disabled until their client-side submit handlers are attached.
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
