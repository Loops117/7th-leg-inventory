"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

/** Landing page for Supabase invite / magic-link redirects (`redirectTo`). */
export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) router.replace("/companies");
    });

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace("/companies");
    });

    const timeout = window.setTimeout(() => {
      void supabase.auth.getSession().then(({ data: { session } }) => {
        if (!session) router.replace("/login?error=auth_incomplete");
      });
    }, 12_000);

    return () => {
      subscription.unsubscribe();
      window.clearTimeout(timeout);
    };
  }, [router]);

  return (
    <div className="max-w-md space-y-4 py-8">
      <h2 className="text-xl font-semibold">Finishing sign-in…</h2>
      <p className="text-sm text-slate-400">You will be redirected shortly.</p>
    </div>
  );
}
