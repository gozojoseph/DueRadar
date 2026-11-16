import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authClient, clearAuthToken, type AuthSession } from "./auth";

export type AuthStatus = "loading" | "authenticated" | "anonymous";

interface AuthContextValue {
  status: AuthStatus;
  session: AuthSession | null;
  refresh: () => Promise<AuthSession | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function normaliseSession(data: unknown): AuthSession | null {
  if (!data || typeof data !== "object") return null;
  const record = data as { user?: unknown; session?: unknown };
  if (!record.user || !record.session) return null;
  return data as AuthSession;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const mounted = useRef(true);
  const queryClient = useQueryClient();

  const refresh = useCallback(async () => {
    try {
      const result = await authClient.getSession();
      const next = normaliseSession(result?.data);
      // Never leave one user's cached records behind for the next session on a
      // shared browser.
      if (!next) queryClient.clear();
      if (mounted.current) {
        setSession(next);
        setStatus(next ? "authenticated" : "anonymous");
      }
      return next;
    } catch {
      queryClient.clear();
      if (mounted.current) {
        setSession(null);
        setStatus("anonymous");
      }
      return null;
    }
  }, [queryClient]);

  const signOut = useCallback(async () => {
    try {
      await authClient.signOut();
    } catch {
      /* a stale cookie should not block sign-out */
    }
    clearAuthToken();
    queryClient.clear();
    if (mounted.current) {
      setSession(null);
      setStatus("anonymous");
    }
  }, [queryClient]);

  useEffect(() => {
    mounted.current = true;
    void refresh();

    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const value = useMemo(
    () => ({ status, session, refresh, signOut }),
    [status, session, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
