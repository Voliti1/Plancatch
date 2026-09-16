"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { authApi } from "./api";
import { SESSION_EXPIRED, tokenStore } from "@/lib/auth/token";
import { errorMessage } from "@/lib/api/client";
import type { User } from "@/types/api";
interface AuthState {
  user: User | null;
  loading: boolean;
  error: string;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => void;
}
const AuthContext = createContext<AuthState | null>(null);
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const logout = useCallback(() => {
    generation.current++;
    tokenStore.clear();
    setUser(null);
    setError("");
    setLoading(false);
  }, []);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    try {
      if (tokenStore.get()) {
        const me = await authApi.me();
        if (current === generation.current) setUser(me);
      }
    } catch (err) {
      if (current === generation.current) setError(errorMessage(err));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    const current = generation.current;
    async function restore() {
      try {
        const me = tokenStore.get() ? await authApi.me() : null;
        if (active && current === generation.current) setUser(me);
      } catch (err) {
        if (active && current === generation.current)
          setError(errorMessage(err));
      } finally {
        if (active && current === generation.current) setLoading(false);
      }
    }
    void restore();
    window.addEventListener(SESSION_EXPIRED, logout);
    return () => {
      active = false;
      window.removeEventListener(SESSION_EXPIRED, logout);
    };
  }, [logout]);
  async function login(email: string, password: string) {
    const token = await authApi.login(email, password);
    tokenStore.set(token.access_token);
    try {
      const me = await authApi.me();
      generation.current++;
      setUser(me);
      setError("");
      setLoading(false);
    } catch (err) {
      tokenStore.clear();
      throw err;
    }
  }
  return (
    <AuthContext.Provider
      value={{ user, loading, error, login, logout, refresh }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("AuthProvider is missing");
  return context;
}
