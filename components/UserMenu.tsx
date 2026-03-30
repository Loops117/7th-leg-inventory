"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";

type UserInfo = {
  id: string;
  email?: string;
  full_name?: string;
};

export function UserMenu() {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    function mapUser(u: User) {
      const meta = u.user_metadata as { full_name?: string; name?: string } | undefined;
      return {
        id: u.id,
        email: u.email ?? undefined,
        full_name: meta?.full_name ?? meta?.name,
      };
    }

    void supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ? mapUser(session.user) : null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ? mapUser(session.user) : null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <span className="text-xs text-slate-400" aria-busy="true">
        Loading user…
      </span>
    );
  }

  if (!user) {
    return (
      <button
        type="button"
        onClick={() => router.push("/login")}
        className="rounded border border-emerald-500/60 px-3 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/10"
      >
        Log in
      </button>
    );
  }

  const displayName = user.full_name || user.email || "User";

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="max-w-[180px] truncate text-slate-200">
        {displayName}
      </span>
      <button
        type="button"
        onClick={async () => {
          await supabase.auth.signOut();
          router.push("/login");
        }}
        className="rounded border border-slate-700 px-3 py-1 text-xs font-medium text-slate-200 hover:border-red-400 hover:text-red-300"
      >
        Log out
      </button>
    </div>
  );
}

