import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

type Role = "user" | "admin" | "superadmin";

type Props = {
  children: JSX.Element;
  /** Legacy: non-user routes required admin/superadmin via localStorage role. */
  role?: Role;
  /** If set, session role must be one of these (JWT role stored at login). */
  allowedRoles?: Role[];
  /** When role checks fail, navigate here instead of `/home` (e.g. main app URL from admin SPA). */
  forbiddenRedirect?: string;
};

export function ProtectedRoute({ children, role = "user", allowedRoles, forbiddenRedirect }: Props) {
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const currentRole = (localStorage.getItem("role") as Role) || "user";
  const denyHome = forbiddenRedirect ?? "/home";
  if (!isAuthenticated) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?redirect=${encodeURIComponent(next)}`} replace />;
  }
  if (allowedRoles?.length) {
    if (!allowedRoles.includes(currentRole)) return <Navigate to={denyHome} replace />;
    return children;
  }
  if (role !== "user" && currentRole === "user") return <Navigate to={denyHome} replace />;
  return children;
}
