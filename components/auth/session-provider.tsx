"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useUser } from "@clerk/nextjs";
import {
  getMe,
  updateMyProfile,
  consumeMyCredit,
  type MeData,
} from "@/app/actions/me";
import type { ContractorProfile } from "@/lib/auth-mock";
import { ImpersonationBanner } from "./impersonation-banner";

export type SessionShape = {
  user: {
    id: string;
    name: string;
    email: string;
    initials: string;
    provider: "email" | "google" | "other";
    role: "CONTRACTOR" | "WORKER" | "SUPER_ADMIN";
  };
  profile: ContractorProfile;
  credits: MeData["credits"];
  signedAt: string;
  impersonation?: NonNullable<MeData["impersonation"]>;
};

type Ctx = {
  session: SessionShape | null;
  loading: boolean;
  refresh: () => Promise<void>;
  updateProfile: (patch: Partial<ContractorProfile>) => Promise<void>;
  consumeCredit: (
    address: string,
  ) => Promise<{ ok: boolean; reused: boolean; remaining: number; reason?: string }>;
};

const SessionContext = createContext<Ctx>({
  session: null,
  loading: true,
  refresh: async () => undefined,
  updateProfile: async () => undefined,
  consumeCredit: async () => ({ ok: false, reused: false, remaining: 0 }),
});

function initialsFromName(name: string, fallback: string) {
  const parts = name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .filter(Boolean);
  if (parts.length === 0) return fallback.slice(0, 2).toUpperCase();
  return parts.slice(0, 2).join("");
}

function detectProvider(
  externalAccounts: Array<{ provider: string }> | undefined,
): "email" | "google" | "other" {
  if (!externalAccounts || externalAccounts.length === 0) return "email";
  const first = externalAccounts[0]?.provider ?? "";
  if (first.includes("google")) return "google";
  return "other";
}

function shapeSession(
  me: MeData,
  signedAt: string,
  provider: "email" | "google" | "other",
): SessionShape {
  return {
    user: {
      id: me.user.id,
      name: me.user.name,
      email: me.user.email,
      initials: initialsFromName(me.user.name, me.user.email),
      provider,
      role: me.user.role,
    },
    profile: me.profile,
    credits: me.credits,
    signedAt,
    impersonation: me.impersonation,
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const { user: clerkUser, isLoaded, isSignedIn } = useUser();
  const [session, setSession] = useState<SessionShape | null>(null);
  const [loading, setLoading] = useState(true);

  const provider = detectProvider(
    clerkUser?.externalAccounts as { provider: string }[] | undefined,
  );
  const signedAt = clerkUser?.lastSignInAt
    ? new Date(clerkUser.lastSignInAt).toISOString()
    : new Date().toISOString();

  const refresh = useCallback(async () => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setSession(null);
      setLoading(false);
      return;
    }
    try {
      const me = await getMe();
      if (!me) {
        setSession(null);
      } else {
        setSession(shapeSession(me, signedAt, provider));
      }
    } catch (e) {
      // Server action threw (DB cold-start, Clerk hiccup, missing env).
      // Without this catch the rejection propagates to global-error.tsx
      // as a generic "Server Components render" 500 — wiping the whole
      // app instead of just leaving the session empty.
      console.error("[SessionProvider] getMe failed", e);
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, [isLoaded, isSignedIn, provider, signedAt]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  const update = useCallback(
    async (patch: Partial<ContractorProfile>) => {
      const me = await updateMyProfile(patch);
      if (me) setSession(shapeSession(me, signedAt, provider));
    },
    [provider, signedAt],
  );

  const consume = useCallback(
    async (address: string) => {
      const result = await consumeMyCredit(address);
      await refresh();
      return result;
    },
    [refresh],
  );

  return (
    <SessionContext.Provider
      value={{
        session,
        loading,
        refresh,
        updateProfile: update,
        consumeCredit: consume,
      }}
    >
      <ImpersonationBanner />
      {children}
    </SessionContext.Provider>
  );
}

export function useSessionContext() {
  return useContext(SessionContext);
}
