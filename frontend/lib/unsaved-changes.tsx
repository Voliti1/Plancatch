"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export const LEAVE_MESSAGE =
  "저장하지 않은 내용이 있습니다. 이동하면 작성한 내용이 사라집니다. 이동하시겠습니까?";
export const DISCARD_NAVIGATION_EVENT = "plancatch:discard-navigation";

interface Guard {
  update: (id: symbol, dirty: boolean) => void;
  confirmLeave: (id?: symbol) => boolean;
}
const Context = createContext<Guard | null>(null);

// The Navigation API supplies real history indexes; no extra history entries or
// changes to Next.js's router/history state are needed to restore a cancelled Back.
interface BrowserNavigation extends EventTarget {
  currentEntry: { index: number } | null;
}
const routeKey = () => location.pathname + location.search;

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const dirtyForms = useRef(new Set<symbol>());
  const skipUnload = useRef(false);
  const beforeUnload = useCallback((event: BeforeUnloadEvent) => {
    if (!dirtyForms.current.size || skipUnload.current) return;
    event.preventDefault();
    event.returnValue = "";
  }, []);
  const update = useCallback(
    (id: symbol, dirty: boolean) => {
      if (dirty) dirtyForms.current.add(id);
      else dirtyForms.current.delete(id);
      if (dirtyForms.current.size)
        window.addEventListener("beforeunload", beforeUnload);
      else window.removeEventListener("beforeunload", beforeUnload);
    },
    [beforeUnload],
  );
  const confirmLeave = useCallback((id?: symbol) => {
    const dirty = id ? dirtyForms.current.has(id) : dirtyForms.current.size > 0;
    if (!dirty) return true;
    const accepted = window.confirm(LEAVE_MESSAGE);
    if (accepted) window.dispatchEvent(new Event(DISCARD_NAVIGATION_EVENT));
    return accepted;
  }, []);

  useEffect(() => {
    let resetUnload: ReturnType<typeof setTimeout> | undefined;
    function click(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      )
        return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (
        !link ||
        link.hasAttribute("download") ||
        (link.target && link.target !== "_self") ||
        link.getAttribute("aria-disabled") === "true"
      )
        return;
      const destination = new URL(link.href, location.href);
      if (!/^https?:$/.test(destination.protocol)) return;
      // In-page anchors and skip links do not discard the current form.
      if (
        destination.origin === location.origin &&
        destination.pathname === location.pathname &&
        destination.search === location.search &&
        destination.hash
      )
        return;
      if (!confirmLeave()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      } else if (dirtyForms.current.size) {
        // An accepted full-page link must not ask a second native question.
        skipUnload.current = true;
        resetUnload = setTimeout(() => {
          skipUnload.current = false;
        }, 0);
      }
    }
    window.addEventListener("click", click, true);

    const navigation = (window as Window & { navigation?: BrowserNavigation })
      .navigation;
    let index = navigation?.currentEntry?.index;
    let currentRoute = routeKey();
    let restoring: number | undefined;
    function entryChange(event: Event) {
      const type = (event as Event & { navigationType?: string })
        .navigationType;
      if (type !== "traverse") {
        index = navigation?.currentEntry?.index;
        currentRoute = routeKey();
      }
    }
    function pop(event: PopStateEvent) {
      const next = navigation?.currentEntry?.index;
      if (next === undefined || index === undefined) return;
      if (restoring !== undefined) {
        event.stopImmediatePropagation();
        if (next === restoring) restoring = undefined;
        return;
      }
      if (routeKey() !== currentRoute && !confirmLeave()) {
        event.stopImmediatePropagation();
        restoring = index;
        history.go(index - next);
        return;
      }
      index = next;
      currentRoute = routeKey();
    }
    navigation?.addEventListener("currententrychange", entryChange);
    if (navigation) window.addEventListener("popstate", pop, true);
    return () => {
      clearTimeout(resetUnload);
      window.removeEventListener("click", click, true);
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("popstate", pop, true);
      navigation?.removeEventListener("currententrychange", entryChange);
    };
  }, [beforeUnload, confirmLeave]);

  const guard = useMemo(
    () => ({ update, confirmLeave }),
    [update, confirmLeave],
  );
  return <Context.Provider value={guard}>{children}</Context.Provider>;
}

export function useUnsavedNavigation() {
  const context = useContext(Context);
  if (!context) throw new Error("UnsavedChangesProvider is required");
  return context;
}

// Snapshots stay in memory. Text, files, AI consent and credentials are never
// written to browser storage. Reverting all fields also clears the warning.
export function useUnsavedChanges(snapshot: string, enabled = true) {
  const { update, confirmLeave } = useUnsavedNavigation();
  const [id] = useState(() => Symbol("unsaved-form"));
  const [baseline, setBaseline] = useState(snapshot);
  const latest = useRef(snapshot);
  const dirty = enabled && snapshot !== baseline;
  useLayoutEffect(() => {
    latest.current = snapshot;
    update(id, dirty);
    return () => update(id, false);
  }, [dirty, id, snapshot, update]);
  const markSaved = useCallback(
    (saved?: string) => {
      update(id, false);
      setBaseline(saved ?? latest.current);
    },
    [id, update],
  );
  const confirmDiscard = useCallback(() => {
    if (!confirmLeave(id)) return false;
    markSaved();
    return true;
  }, [confirmLeave, id, markSaved]);
  return { markSaved, confirmDiscard };
}
