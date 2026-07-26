"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-mock";

export function Nav() {
  const { session } = useSession();
  return (
    <motion.header
      initial={{ y: -16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="fixed inset-x-0 top-0 z-50 border-b border-ink/10 bg-paper/95"
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 lg:px-6">
        <Link href="/" className="ring-focus rounded-md">
          <Logo />
        </Link>
        <div className="flex items-center gap-8">
          <nav className="hidden items-center gap-8 md:flex">
            <a
              className="font-label text-ink/70 transition hover:text-ink"
              href="#how"
            >
              How it works
            </a>
            <a
              className="font-label text-ink/70 transition hover:text-ink"
              href="#features"
            >
              Features
            </a>
            <a
              className="font-label text-ink/70 transition hover:text-ink"
              href="#pricing"
            >
              Pricing
            </a>
          </nav>
          <div className="flex items-center gap-2">
            {session ? (
              <Link href="/dashboard">
                <Button variant="dark" size="sm">
                  Open dashboard
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            ) : (
              <>
                <Link href="/sign-in">
                  <Button variant="ghost" size="sm">
                    Sign in
                  </Button>
                </Link>
                <Link href="/sign-in">
                  <Button variant="dark" size="sm">
                    Start free
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </motion.header>
  );
}
