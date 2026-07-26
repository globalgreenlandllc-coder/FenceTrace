"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { Loader2 } from "lucide-react";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useUser();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      const next = encodeURIComponent(pathname || "/dashboard");
      router.replace(`/sign-in?redirect_url=${next}`);
    }
  }, [isLoaded, isSignedIn, pathname, router]);

  if (!isLoaded || !isSignedIn) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-white">
        <Loader2 className="h-5 w-5 animate-spin text-accent-600 motion-reduce:animate-none" />
        <p className="microlabel animate-pulse text-zinc-400 motion-reduce:animate-none">
          Loading workspace
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
