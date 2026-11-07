"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Bell, CheckSquare, ChevronDown, Loader2, LogOut, Menu, Search, ShieldCheck, ShieldOff, User, X } from "lucide-react";
import { CommandPalette } from "@/components/CommandPalette";
import { useAuth } from "@/lib/auth-context";
import { canSee, findNavItem, visibleGroups, type NavItem } from "@/lib/navigation";
import { usePendingApprovals, type PendingCounts } from "@/lib/use-pending-approvals";
import { EmptyState, IconButton, Lockup, ThemeToggle } from "@/ui";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout, hasPermission } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [loading, user, router, pathname]);

  // Close overlays on navigation (adjusting state during render, not in an effect).
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setDrawerOpen(false);
    setMenuOpen(false);
    setBellOpen(false);
  }

  // Ctrl/Cmd+K or "/" opens search from anywhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const activeItem = findNavItem(pathname);

  useEffect(() => {
    document.title = activeItem ? `${activeItem.label} · WorkEasy360` : "WorkEasy360 HRMS";
  }, [activeItem]);

  if (loading || !user) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-secondary">
        <Loader2 className="size-4 animate-spin" /> Loading your workspace…
      </div>
    );
  }

  const groups = visibleGroups(hasPermission);
  const activeGroup = groups.find((g) => g.title && g.items.some((i) => i.href === activeItem?.href));
  const allowed = !activeItem || canSee(activeItem, hasPermission);
  const displayName = user.employee ? `${user.employee.firstName} ${user.employee.lastName}` : user.email;
  const initials = (user.employee ? `${user.employee.firstName[0]}${user.employee.lastName[0]}` : user.email[0]).toUpperCase();

  function toggleGroup(title: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }

  const sidebar = (
    <nav aria-label="Main" className="c-nav flex-1 px-3 pb-4">
      {groups.map((group, i) => {
        if (!group.title) {
          return (
            <div key={i} className="c-nav pb-2">
              {group.items.map((item) => (
                <NavLink key={item.href} item={item} active={item.href === activeItem?.href} />
              ))}
            </div>
          );
        }
        const isOpen = group === activeGroup || !collapsed.has(group.title);
        return (
          <div key={i}>
            <button onClick={() => toggleGroup(group.title!)} aria-expanded={isOpen} className="c-nav-group-label">
              {group.title}
              <ChevronDown className={`size-3.5 transition-transform ${isOpen ? "" : "-rotate-90"}`} />
            </button>
            {isOpen && (
              <div className="c-nav pb-2">
                {group.items.map((item) => (
                  <NavLink key={item.href} item={item} active={item.href === activeItem?.href} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );

  const brand = (
    <Link href="/dashboard" className="flex h-topbar shrink-0 items-center px-5">
      <Lockup onDark />
    </Link>
  );

  return (
    <div className="flex min-h-screen flex-1">
      <a href="#main" className="sr-only z-50 rounded-md bg-surface px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:left-2 focus:top-2">
        Skip to content
      </a>

      {/* Desktop sidebar. Below 960px it becomes the drawer below. */}
      <aside
        data-region="primary"
        className="sticky top-0 hidden h-screen w-sidebar shrink-0 flex-col overflow-y-auto bg-navy shell:flex"
      >
        {brand}
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 shell:hidden">
          <div className="c-scrim" onClick={() => setDrawerOpen(false)} />
          <aside data-region="primary" className="c-drawer">
            <div className="flex items-start justify-between">
              {brand}
              <IconButton icon={X} onClick={() => setDrawerOpen(false)} aria-label="Close menu" className="mt-2 mr-2" />
            </div>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-topbar shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <IconButton icon={Menu} onClick={() => setDrawerOpen(true)} aria-label="Open menu" className="-ml-2 shell:hidden" />

            {/* The workspace: one company per signed-in user, so this is a
                breadcrumb rather than a switcher. */}
            <div className="hidden min-w-0 items-center gap-2 text-sm font-medium text-secondary sm:flex">
              {activeItem && (
                <>
                  <activeItem.icon className="size-4 shrink-0" strokeWidth={2} aria-hidden />
                  {activeGroup && (
                    <>
                      <span className="truncate">{activeGroup.title}</span>
                      <span aria-hidden>/</span>
                    </>
                  )}
                  <span className="truncate text-heading">{activeItem.label}</span>
                </>
              )}
            </div>

            <button onClick={() => setPaletteOpen(true)} className="c-search ml-auto sm:w-64" aria-label="Search">
              <Search className="size-4 shrink-0" aria-hidden />
              <span className="hidden flex-1 text-left sm:inline">Search…</span>
              <kbd className="c-kbd hidden sm:inline">Ctrl K</kbd>
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <ApprovalsBell open={bellOpen} setOpen={setBellOpen} />
            <ThemeToggle />

            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={`Account menu for ${displayName}`}
                className="flex items-center gap-2 rounded-full p-1 hover:bg-muted sm:pr-2"
              >
                <span className="flex size-7 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-strong">
                  {initials}
                </span>
                <span className="hidden max-w-40 truncate text-sm font-medium text-body md:inline">{displayName}</span>
                <ChevronDown className="hidden size-3.5 text-secondary md:block" aria-hidden />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-0" onClick={() => setMenuOpen(false)} />
                  <div role="menu" className="c-menu absolute right-0 top-full z-10 mt-2 w-64">
                    <div className="c-menu-head">
                      <p className="truncate text-sm font-medium text-heading">{displayName}</p>
                      <p className="truncate text-xs text-secondary">{user.email}</p>
                      {user.roles.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {user.roles.map((r) => (
                            <span key={r} className="c-tag">
                              {r}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <MenuLink href="/my-profile" icon={User} label="My profile" />
                    <MenuLink
                      href="/settings/security"
                      icon={user.totpEnabled ? ShieldCheck : ShieldOff}
                      label={user.totpEnabled ? "Security" : "Security · turn on 2FA"}
                    />
                    <hr className="c-menu-sep" />
                    <button role="menuitem" onClick={logout} className="c-menu-item" data-tone="danger">
                      <LogOut strokeWidth={2} aria-hidden />
                      Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {user.mustChangePassword && pathname !== "/settings/security" && (
          <div className="px-4 pt-4 sm:px-6">
            <div className="c-alert" data-tone="warning">
              <span>You&apos;re signed in with a temporary password. Choose your own to keep your account secure.</span>
              <Link href="/settings/security" className="c-link shrink-0">
                Set my password
              </Link>
            </div>
          </div>
        )}

        {/* Step 1 of the page contract, hoisted here so no page can forget it. */}
        <main id="main" className="c-page flex-1">
          {allowed ? (
            children
          ) : (
            <EmptyState
              icon={ShieldOff}
              title="You don't have access to this page"
              description="Ask your HR administrator if you think you should. In the meantime, here's the way back."
              action={
                <Link href="/dashboard" className="c-link">
                  Go to Home
                </Link>
              }
            />
          )}
        </main>
      </div>

      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}

function ApprovalsBell({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const counts = usePendingApprovals();
  const rows: { key: keyof PendingCounts; label: string }[] = [
    { key: "leave", label: "Leave requests" },
    { key: "timesheets", label: "Timesheets" },
    { key: "expenses", label: "Expense claims" },
    { key: "loans", label: "Loan requests" },
  ];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="c-btn-ghost c-btn-icon relative"
        aria-label={counts.total ? `${counts.total} pending approvals` : "Notifications"}
        aria-expanded={open}
      >
        <Bell className="size-icon" strokeWidth={2} aria-hidden />
        {counts.total > 0 && (
          <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-xs font-semibold text-on-danger">
            {counts.total > 99 ? "99+" : counts.total}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-0" onClick={() => setOpen(false)} />
          <div className="c-menu absolute right-0 top-full z-10 mt-2 w-72">
            <p className="c-menu-head text-sm font-semibold text-heading">Waiting on you</p>
            {counts.total === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-secondary">You&apos;re all caught up.</p>
            ) : (
              <ul>
                {rows
                  .filter((r) => counts[r.key] > 0)
                  .map((r) => (
                    <li key={r.key}>
                      <Link href="/approvals" className="c-menu-item justify-between">
                        <span className="flex items-center gap-2">
                          <CheckSquare strokeWidth={2} aria-hidden /> {r.label}
                        </span>
                        <span className="c-badge" data-tone="warning">
                          {counts[r.key]}
                        </span>
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
            <hr className="c-menu-sep" />
            <Link href="/approvals" className="c-menu-item justify-center text-xs font-medium">
              Open approvals
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function MenuLink({ href, icon: Icon, label }: { href: string; icon: NavItem["icon"]; label: string }) {
  return (
    <Link role="menuitem" href={href} className="c-menu-item">
      <Icon strokeWidth={2} aria-hidden />
      {label}
    </Link>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} className="c-nav-item">
      <Icon strokeWidth={2} aria-hidden />
      {item.label}
    </Link>
  );
}
