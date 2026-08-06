"use client";
import { createContext, useContext, useMemo } from "react";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";

/**
 * The coverage-area list, fetched once per session instead of once per page.
 * Four components used to each run their own api.municipalities() effect,
 * which meant four requests for a list that changes about as often as the
 * company signs a new pilot.
 */
const MunicipalitiesContext = createContext(null);

export function MunicipalitiesProvider({ children }) {
  const { data, error, loading, reload } = useAsync(() => api.municipalities(), []);

  const value = useMemo(
    () => ({ municipalities: data ?? [], loading, error, reload }),
    [data, loading, error, reload]
  );

  return (
    <MunicipalitiesContext.Provider value={value}>
      {children}
    </MunicipalitiesContext.Provider>
  );
}

export function useMunicipalities() {
  const ctx = useContext(MunicipalitiesContext);
  if (!ctx) {
    throw new Error("useMunicipalities must be used within a MunicipalitiesProvider");
  }
  return ctx;
}

/** Look one up by id without caring whether the id arrived as a string. */
export function useMunicipality(id) {
  const { municipalities, loading, error } = useMunicipalities();
  const municipality = useMemo(
    () => municipalities.find((m) => String(m.id) === String(id)),
    [municipalities, id]
  );
  return { municipality, loading, error };
}
