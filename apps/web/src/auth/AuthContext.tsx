import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { routes } from "@reno/shared";
import { api, setTokenGetter } from "../api/client.js";

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  display_name?: string | null;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  /** Request an OTP for an email. Returns a dev code if the API is in dev mode. */
  requestOtp: (email: string) => Promise<{ devCode?: string }>;
  /** Verify the code; on success stores the session token and loads the user. */
  verifyOtp: (email: string, code: string) => Promise<void>;
  logout: () => void;
}

const TOKEN_KEY = "reno.token";
const AuthCtx = createContext<AuthState | null>(null);

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

// Wire the stored token into the API client immediately (module load).
setTokenGetter(async () => getToken() ?? "");

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount, if a token exists, validate it by loading the current user.
  useEffect(() => {
    (async () => {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        setUser(await api.get<AuthUser>(routes.me));
      } catch {
        localStorage.removeItem(TOKEN_KEY);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      requestOtp: async (email) =>
        api.post<{ sent: boolean; devCode?: string }>(routes.otpRequest, { email }),
      verifyOtp: async (email, code) => {
        const res = await api.post<{ token: string; user: AuthUser }>(routes.otpVerify, {
          email,
          code,
        });
        localStorage.setItem(TOKEN_KEY, res.token);
        setUser(res.user);
      },
      logout: () => {
        localStorage.removeItem(TOKEN_KEY);
        setUser(null);
      },
    }),
    [user, loading],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
