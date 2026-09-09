import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  type AuthUser,
  fetchCurrentUser,
  isExpired,
  login as loginRequest,
  type LoginInput,
  readTokenExpiry,
} from "@/domain/auth";
import {
  ApiError,
  initApiBaseUrl,
  setTokenProvider,
  setUnauthorizedHandler,
} from "@/lib/api";
import {
  getConnectivity,
  isProbablyOnline,
  subscribeConnectivity,
} from "@/lib/net";
import { deleteToken, loadToken, saveToken } from "@/lib/secure";
import {
  clearCache,
  readJson,
  removeKey,
  StorageKeys,
  writeJson,
} from "@/lib/storage";

type AuthStatus = "loading" | "signed-out" | "signed-in";

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  /**
   * Há sessão em cache, mas o token não vale mais. O app continua utilizável
   * (dados locais + fila offline) e pede novo login para sincronizar.
   */
  sessionExpired: boolean;
  signIn: (input: LoginInput) => Promise<AuthUser>;
  signOut: (options?: { keepQueue?: boolean }) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  // O token é lido pelo `apiRequest` fora da árvore React (flush do outbox),
  // então vive num ref e não no state.
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    setTokenProvider(() => tokenRef.current);
    setUnauthorizedHandler(() => setSessionExpired(true));
  }, []);

  useEffect(() => {
    let active = true;

    async function restore() {
      await initApiBaseUrl();

      const [token, storedUser, expiresAt] = await Promise.all([
        loadToken(),
        readJson<AuthUser>(StorageKeys.user),
        readJson<number>(StorageKeys.sessionExpiresAt),
      ]);

      if (!active) return;

      if (!token || !storedUser) {
        setStatus("signed-out");
        return;
      }

      tokenRef.current = token;
      setUser(storedUser);
      setSessionExpired(isExpired(expiresAt));
      setStatus("signed-in");
    }

    void restore();
    return () => {
      active = false;
    };
  }, []);

  /**
   * Confere a sessão contra a API (`GET /auth/me`).
   *
   * O usuário guardado no aparelho é uma foto do momento do login: um papel
   * alterado pelo administrador só chegaria aqui no próximo login. Revalidar
   * ao abrir o app e ao recuperar sinal mantém as permissões da tela em dia.
   *
   * Falha de rede não muda nada — o dado local continua sendo o melhor que
   * existe. Só um 401 explícito derruba a sessão; o backend responde 500 para
   * token expirado (ver Limitações no README), e 500 não é motivo para
   * desautenticar ninguém.
   */
  const revalidate = useCallback(async () => {
    if (tokenRef.current === null) return;
    if (!isProbablyOnline(getConnectivity())) return;

    try {
      const fresh = await fetchCurrentUser();
      setUser(fresh);
      setSessionExpired(false);
      await writeJson(StorageKeys.user, fresh);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setSessionExpired(true);
      }
    }
  }, []);

  // Ao entrar com sessão restaurada e ao voltar o sinal.
  useEffect(() => {
    if (status !== "signed-in" || sessionExpired) return;

    void revalidate();

    return subscribeConnectivity((connectivity) => {
      if (isProbablyOnline(connectivity)) void revalidate();
    });
  }, [status, sessionExpired, revalidate]);

  const signIn = useCallback(async (input: LoginInput) => {
    const response = await loginRequest(input);
    const { token, userResponseDTO } = response;

    tokenRef.current = token;

    await Promise.all([
      saveToken(token),
      writeJson(StorageKeys.user, userResponseDTO),
      writeJson(StorageKeys.sessionExpiresAt, readTokenExpiry(token)),
    ]);

    setUser(userResponseDTO);
    setSessionExpired(false);
    setStatus("signed-in");

    return userResponseDTO;
  }, []);

  const signOut = useCallback(async (options?: { keepQueue?: boolean }) => {
    tokenRef.current = null;

    await Promise.all([
      deleteToken(),
      removeKey(StorageKeys.user),
      removeKey(StorageKeys.sessionExpiresAt),
      clearCache(),
    ]);

    // A fila é preservada por padrão: sair da conta não pode descartar
    // apontamentos que o usuário registrou no campo e ainda não subiram.
    if (options?.keepQueue === false) {
      await removeKey(StorageKeys.outbox);
    }

    setUser(null);
    setSessionExpired(false);
    setStatus("signed-out");
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, sessionExpired, signIn, signOut }),
    [status, user, sessionExpired, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth precisa estar dentro de <AuthProvider>.");
  }
  return context;
}

/** Perfis autorizados a criar/editar planos e apontamentos no backend. */
const WRITE_ROLES = new Set(["ADMIN", "TECHNICIAN", "FARMER"]);

export function useCanWrite(): boolean {
  const { user } = useAuth();
  return user ? WRITE_ROLES.has(user.role) : false;
}
