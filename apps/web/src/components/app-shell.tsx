import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { useAuth } from "@/auth/auth-context";
import { colourFor } from "@/lib/colours";

const navBase =
  "px-3.5 py-2.5 rounded-md text-[17px] font-medium text-muted hover:text-ink transition-colors";
const navActive = "bg-primary-soft text-primary";

export function AppShell() {
  const { member, isParent, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const isChild = member?.member_type === "child";
  const colour = colourFor(member?.id, member?.short_name);

  const initials = (member?.short_name ?? "?")
    .split(/\s+/)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="bg-white border-b border-line sticky top-0 z-30">
        <div className="mx-auto max-w-[1100px] px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-4 sm:gap-6">
          <Link
            to="/"
            className="flex items-center gap-2.5"
            onClick={() => setMenuOpen(false)}
          >
            <span
              className="grid place-items-center size-8 rounded-md bg-primary text-white text-[16px] font-semibold"
              aria-hidden
            >
              R
            </span>
            <span className="text-[19px] font-semibold text-ink tracking-[-0.01em]">
              Rush HQ
            </span>
          </Link>

          <nav className="hidden sm:flex items-center gap-0.5 ml-2">
            <NavLink
              to="/"
              end
              className={({ isActive }) => [navBase, isActive && navActive].filter(Boolean).join(" ")}
            >
              Calendar
            </NavLink>
            {!member?.role || member.role !== "helper" ? (
              <NavLink
                to="/tasks"
                className={({ isActive }) => [navBase, isActive && navActive].filter(Boolean).join(" ")}
              >
                Tasks
              </NavLink>
            ) : null}
            {isParent() && (
              <NavLink
                to="/beads"
                className={({ isActive }) => [navBase, isActive && navActive].filter(Boolean).join(" ")}
              >
                Beads
              </NavLink>
            )}
            {isParent() && (
              <NavLink
                to="/stocks"
                className={({ isActive }) => [navBase, isActive && navActive].filter(Boolean).join(" ")}
              >
                Stocks
              </NavLink>
            )}
            {isParent() && (
              <NavLink
                to="/finance"
                className={({ isActive }) => [navBase, isActive && navActive].filter(Boolean).join(" ")}
              >
                Finance
              </NavLink>
            )}
            {isChild && (
              <NavLink
                to="/beads/me"
                className={({ isActive }) => [navBase, isActive && navActive].filter(Boolean).join(" ")}
              >
                Beads
              </NavLink>
            )}
            {isChild && (
              <NavLink
                to="/stocks/me"
                className={({ isActive }) => [navBase, isActive && navActive].filter(Boolean).join(" ")}
              >
                Investment
              </NavLink>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {/* Desktop user menu */}
            <div className="hidden sm:block">
              <UserMenu
                shortName={member?.short_name ?? ""}
                initials={initials}
                accent={colour.accent}
                soft={colour.soft}
                isParent={isParent()}
                onSignOut={() => signOut()}
              />
            </div>

            {/* Mobile hamburger */}
            <button
              type="button"
              className="sm:hidden inline-flex items-center justify-center size-9 rounded-md text-muted hover:text-ink hover:bg-soft"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
                {menuOpen ? (
                  <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
                ) : (
                  <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="sm:hidden border-t border-line bg-white">
            <nav className="flex flex-col p-3 gap-1 max-w-[1100px] mx-auto">
              <NavLink
                to="/"
                end
                className={({ isActive }) => [navBase, isActive && navActive].filter(Boolean).join(" ")}
                onClick={() => setMenuOpen(false)}
              >
                Calendar
              </NavLink>
              {(!member?.role || member.role !== "helper") && (
                <NavLink
                  to="/tasks"
                  className={({ isActive }) => [navBase, isActive && navActive].filter(Boolean).join(" ")}
                  onClick={() => setMenuOpen(false)}
                >
                  Tasks
                </NavLink>
              )}
              {isParent() && (
                <NavLink
                  to="/beads"
                  className={({ isActive }) => [navBase, isActive && navActive].filter(Boolean).join(" ")}
                  onClick={() => setMenuOpen(false)}
                >
                  Beads
                </NavLink>
              )}
              {isParent() && (
                <NavLink
                  to="/stocks"
                  className={({ isActive }) => [navBase, isActive && navActive].filter(Boolean).join(" ")}
                  onClick={() => setMenuOpen(false)}
                >
                  Stocks
                </NavLink>
              )}
              {isParent() && (
                <NavLink
                  to="/finance"
                  className={({ isActive }) => [navBase, isActive && navActive].filter(Boolean).join(" ")}
                  onClick={() => setMenuOpen(false)}
                >
                  Finance
                </NavLink>
              )}
              {isChild && (
                <NavLink
                  to="/beads/me"
                  className={({ isActive }) => [navBase, isActive && navActive].filter(Boolean).join(" ")}
                  onClick={() => setMenuOpen(false)}
                >
                  Beads
                </NavLink>
              )}
              {isChild && (
                <NavLink
                  to="/stocks/me"
                  className={({ isActive }) => [navBase, isActive && navActive].filter(Boolean).join(" ")}
                  onClick={() => setMenuOpen(false)}
                >
                  Investment
                </NavLink>
              )}

              <hr className="my-2 border-line" />

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
                className="text-left px-3 py-2 rounded-md text-[16px] text-muted hover:text-ink hover:bg-soft"
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

interface UserMenuProps {
  shortName: string;
  initials: string;
  accent: string;
  soft: string;
  isParent: boolean;
  onSignOut: () => void;
}

function UserMenu({ shortName, initials, accent, soft, isParent, onSignOut }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-2 h-9 pl-1 pr-2.5 rounded-full hover:bg-soft transition-colors"
      >
        <span
          className="grid place-items-center size-7 rounded-full text-[14px] font-semibold"
          style={{ background: soft, color: accent }}
          aria-hidden
        >
          {initials}
        </span>
        <span className="text-[15.5px] font-medium text-ink">{shortName}</span>
        <ChevronDown size={14} className="text-muted" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 min-w-[180px] bg-white border border-line rounded-md shadow-[0_8px_24px_-8px_rgba(15,23,42,0.18)] py-1 z-40"
        >
          <Link
            to="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-[15.5px] text-ink hover:bg-soft"
          >
            Settings
          </Link>
          {isParent && (
            <Link
              to="/admin"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-[15.5px] text-ink hover:bg-soft"
            >
              Admin
            </Link>
          )}
          <hr className="my-1 border-line" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
            className="block w-full text-left px-3 py-2 text-[15.5px] text-muted hover:text-danger hover:bg-soft"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
