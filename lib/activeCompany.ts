export type ActiveCompany = {
  id: string;
  name: string;
};

const STORAGE_KEY = "activeCompany";

export function loadActiveCompany(): ActiveCompany | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ActiveCompany;
  } catch {
    return null;
  }
}

export function saveActiveCompany(company: ActiveCompany | null) {
  if (typeof window === "undefined") return;
  if (!company) {
    window.localStorage.removeItem(STORAGE_KEY);
  } else {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(company));
  }
}

