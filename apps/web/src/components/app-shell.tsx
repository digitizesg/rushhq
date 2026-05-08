import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@/auth/auth-context";

const navBase =
  "px-3 py-2 rounded-md text-[14px] font-medium text-muted hover:text-ink hover:bg-soft transition-colors";
const navActive = "text-ink bg-soft";

export function AppShell() {
  const { member, isParent, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const isChild = member?.member_type === "child";

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="bg-page border-b border-line">
        <div className="mx-auto max-w-[1100px] px-4 sm:px-6 h-14 flex items-center gap-4">
          <Link
            to="/"
            className="text-[19px] font-medium text-ink"
            onClick={() => setMenuOpen(false)}
          >
            Rush HQ
          </Link>

          <nav className="hidden sm:flex items-center gap-1 ml-4">
            <NavLink
              to="/"
              end
              className={({ isActive }) => [navBase, isActive && navActive].filter(Boolean).join(" ")}
            >
              Calendar
            </NavLink>
            {isParent() && (
              <NavLink
                to="/beads"
                className={({ isActive }) => [navBase, isActive && navActive].filter(Boolean).join(" ")}
              >
                Beads
              </NavLink>
            )}
            {isChild && (
              <NavLink
                to="/beads/me"
                className={({ isActive }) => [navBase, isActive && navActive].filter(Boolean).join(" ")}
              >
                My beads
              </NavLink>
            )}
            <NavLink
              to="/settings"
              className={({ isActive }) => [navBase, isActive && navActive].filter(Boolean).join(" ")}
            >
              Settings
            </NavLink>
            {isParent() && (
              <NavLink
                to="/admin"
                className={({ isActive }) => [navBase, isActive && navActive].filter(Boolean).join(" ")}
              >
                Admin
              </NavLink>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden sm:inline text-[13px] text-muted">
              {member?.short_name}
            </span>
            <button
              onClick={() => signOut()}
              className="hidden sm:inline-flex h-8 px-3 rounded-md text-[13px] text-muted hover:text-ink hover:bg-soft transition-colors"
            >
              Sign out
            </button>
            <button
              type="button"
              className="sm:hidden inline-flex items-center justify-center size-9 rounded-md text-muted hover:text-ink hover:bg-soft"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
                {menuOpen ? (
                  <path
                    d="M5 5l10 10M15 5L5 15"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    fill="none"
                  />
                ) : (
                  <path
                    d="M3 6h14M3 10h14M3 14h14"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    fill="none"
                  />
                )}
              </svg>
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="sm:hidden border-t border-line bg-page">
            <nav className="flex flex-col p-3 gap-1 max-w-[1100px] mx-auto">
              <NavLink
                to="/"
                end
                className={({ isActive }) => [navBase, isActive && navActive].filter(Boolean).join(" ")}
                onClick={() => setMenuOpen(false)}
              >
                Calendar
              </NavLink>
              {isParent() && (
                <NavLink
                  to="/beads"
                  className={({ isActive }) => [navBase, isActive && navActive].filter(Boolean).join(" ")}
                  onClick={() => setMenuOpen(false)}
                >
                  Beads
                </NavLink>
              )}
              {isChild && (
                <NavLink
                  to="/beads/me"
                  className={({ isActive }) => [navBase, isActive && navActive].filter(Boolean).join(" ")}
                  onClick={() => setMenuOpen(false)}
                >
                  My beads
                </NavLink>
              )}
              <NavLink
                to="/settings"
                className={({ isActive }) => [navBase, isActive && navActive].filter(Boolean).join(" ")}
                onClick={() => setMenuOpen(false)}
              >
                Settings
              </NavLink>
              {isParent() && (
                <NavLink
                  to="/admin"
                  className={({ isActive }) => [navBase, isActive && navActive].filter(Boolean).join(" ")}
                  onClick={() => setMenuOpen(false)}
                >
                  Admin
                </NavLink>
              )}
              <button
                onClick={() => {
                  setMenuOpen(false);
                  void signOut();
                }}
                className="text-left px-3 py-2 rounded-md text-[14px] text-muted hover:text-ink hover:bg-soft"
              >
                Sign out
              </button>
            </nav>
          </div>
        )}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
