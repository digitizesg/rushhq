import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { FamilyMember } from "@/lib/types";

interface AuthContextValue {
  loading: boolean;
  session: Session | null;
  user: User | null;
  member: FamilyMember | null;
  /** True if the parent has at least one verified TOTP factor. */
  mfaVerified: boolean;
  isParent: () => boolean;
  isHelper: () => boolean;
  /** Force a fresh fetch of the family_members row + MFA state. */
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [member, setMember] = useState<FamilyMember | null>(null);
  const [mfaVerified, setMfaVerified] = useState(false);

  const loadProfile = useCallback(async (user: User | null) => {
    if (!user) {
      setMember(null);
      setMfaVerified(false);
      return;
    }
    const [memberRes, mfaRes] = await Promise.all([
      supabase
        .from("family_members")
        .select("*")
        .eq("auth_user_id", user.id)
        .maybeSingle(),
      supabase.auth.mfa.listFactors(),
    ]);
    if (memberRes.error) {
      console.error("[auth] family_members lookup failed:", memberRes.error);
    }
    setMember((memberRes.data as FamilyMember | null) ?? null);
    const verifiedFactors = mfaRes.data?.totp?.filter((f) => f.status === "verified") ?? [];
    setMfaVerified(verifiedFactors.length > 0);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setSession(data.session);
      await loadProfile(data.session?.user ?? null);
      setLoading(false);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      // Don't await here — we want UI to update immediately. The profile
      // fetch follows in a microtask.
      void loadProfile(next?.user ?? null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const refresh = useCallback(async () => {
    await loadProfile(session?.user ?? null);
  }, [loadProfile, session]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      member,
      mfaVerified,
      isParent: () => member?.role === "parent",
      isHelper: () => member?.role === "helper",
      refresh,
      signOut,
    }),
    [loading, session, member, mfaVerified, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
