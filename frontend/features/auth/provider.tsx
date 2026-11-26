"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { authApi } from "./api";
import { kakaoApi } from "./kakao-api";
import { SESSION_EXPIRED, tokenStore } from "@/lib/auth/token";
import { errorMessage } from "@/lib/api/client";
import type { TokenResponse, User } from "@/types/api";
interface AuthState {
  user: User | null;
  loading: boolean;
  error: string;
  login: (email: string, password: string) => Promise<void>;
  loginGoogle: (credential: string, password?: string) => Promise<void>;
  loginKakao: (code: string, state: string) => Promise<void>;
  logout: () => void;
  refresh: () => void;
  saveTimeZone: (zone: string) => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;
}
const AuthContext = createContext<AuthState | null>(null);
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const pathname = usePathname();
  const router = useRouter();
  const mustRedirect =
    user?.password_change_required && pathname !== "/password-recovery/change";
  useEffect(() => {
    if (mustRedirect) router.replace("/password-recovery/change");
  }, [mustRedirect, router]);
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
      } else if (current === generation.current) {
        setUser(null);
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
  const establishSession = useCallback(
    async (authenticate: () => Promise<TokenResponse>) => {
      const current = ++generation.current;
      const token = await authenticate();
      if (current !== generation.current)
        throw new Error("로그인이 취소되었어요.");
      tokenStore.set(token.access_token);
      try {
        const me = await authApi.me();
        if (current !== generation.current)
          throw new Error("로그인이 취소되었어요.");
        setUser(me);
        setError("");
        setLoading(false);
      } catch (err) {
        if (current === generation.current) tokenStore.clear();
        throw err;
      }
    },
    [],
  );
  const login = (email: string, password: string) =>
    establishSession(() => authApi.login(email, password));
  const loginGoogle = useCallback(
    (credential: string, password?: string) =>
      establishSession(() => authApi.googleLogin(credential, password)),
    [establishSession],
  );
  const loginKakao = useCallback(
    (code: string, state: string) =>
      establishSession(() => kakaoApi.login(code, state)),
    [establishSession],
  );
  async function saveTimeZone(zone: string) {
    const current = generation.current;
    const updated = await authApi.saveTimeZone(zone);
    if (current !== generation.current) return;
    setUser((previous) => (previous?.id === updated.id ? updated : previous));
  }
  async function changePassword(currentPassword: string, nextPassword: string) {
    const current = generation.current;
    const token = await authApi.changePassword(currentPassword, nextPassword);
    if (current !== generation.current)
      throw new Error("로그인 상태가 바뀌었어요. 다시 로그인해 주세요.");
    tokenStore.set(token.access_token);
    setUser((previous) =>
      previous?.password_change_required
        ? { ...previous, password_change_required: false }
        : previous,
    );
  }
  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        login,
        loginGoogle,
        loginKakao,
        logout,
        refresh,
        changePassword,
        saveTimeZone,
      }}
    >
      {!mustRedirect && children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("AuthProvider is missing");
  return context;
}
