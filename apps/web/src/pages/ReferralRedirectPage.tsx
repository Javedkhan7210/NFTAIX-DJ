import { Navigate, useParams } from "react-router-dom";

/**
 * Resolves share links like `${origin}/ref/ABC123` → register with sponsor pre-filled.
 */
export function ReferralRedirectPage() {
  const { code } = useParams<{ code: string }>();
  const ref = code?.trim();
  if (!ref) return <Navigate to="/register" replace />;
  return <Navigate to={`/register?ref=${encodeURIComponent(ref)}`} replace />;
}
