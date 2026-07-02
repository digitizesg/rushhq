import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/auth/auth-context";
import type { MemberRole } from "@/lib/types";
import { LoadingScreen } from "@/components/loading-screen";

/**
 * Gate that requires a logged-in user with a linked family_members row.
 * MFA is optional: anyone who enrols a TOTP factor is still challenged for
 * it at login, but it is no longer forced on parents (this is a family app).
 */
export function RequireAuth() {
  const { loading, session, member } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen />;
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />;
  if (!member) {
    // Auth user exists but no family_members row maps to them. Likely an
    // operator setup issue; the user can do nothing until a parent links
    // the rows in Admin.
    return <Navigate to="/no-profile" replace />;
  }
  return <Outlet />;
}

/** Nested guard: requires a specific role. */
export function RequireRole({ role }: { role: MemberRole }) {
  const { member } = useAuth();
  if (!member) return null; // RequireAuth above will already have redirected.
  if (member.role !== role) return <Navigate to="/" replace />;
  return <Outlet />;
}
