"use client";
import { Suspense } from "react";
import { useAuth } from "@/lib/AuthContext";
import AdminDashboard from "@/components/AdminDashboard";
import AreasView from "@/components/AreasView";

/**
 * "/" is role-dependent: admins land in the admin panel, everyone else on the
 * coverage areas. The Suspense boundary is required because the admin panel
 * reads the section out of the query string with useSearchParams.
 */
export default function Home() {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <AreasView />;
  return (
    <Suspense fallback={null}>
      <AdminDashboard />
    </Suspense>
  );
}
