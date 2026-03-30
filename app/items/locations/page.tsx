"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ItemsLocationsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/locations");
  }, [router]);
  return <p className="text-slate-400">Redirecting to Locations…</p>;
}
