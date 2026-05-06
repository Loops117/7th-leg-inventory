"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export function useAuthSession() {
  const [authReady, setAuthReady] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (cancelled) return;
        setLoggedIn(!!session?.user);
      })
      .catch((err) => {
        console.error("getSession failed:", err);
        if (!cancelled) setLoggedIn(false);
      })
      .finally(() => {
        // Always unlock UI after getSession settles. Do not gate on `cancelled`:
        // React Strict Mode runs effect cleanup before the promise resolves; skipping
        // here leaves authReady false forever and pages that wait on it render blank.
        setAuthReady(true);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setLoggedIn(!!session?.user);
      setAuthReady(true);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return { authReady, loggedIn };
}
