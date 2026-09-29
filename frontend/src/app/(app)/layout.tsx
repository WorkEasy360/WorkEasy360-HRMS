"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Bell, CheckSquare, ChevronDown, Loader2, LogOut, Menu, Search, ShieldCheck, ShieldOff, User, X } from "lucide-react";
import { CommandPalette } from "@/components/CommandPalette";
import { EmptyState } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { canSee, findNavItem, visibleGroups, type NavItem } from "@/lib/navigation";
import { usePendingApprovals, type PendingCounts } from "@/lib/use-pending-approvals";

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

  // Ctrl/Cmd+K opens search from anywhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
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
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your workspace…
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
    <nav aria-label="Main" className="flex-1 space-y-1">
      {groups.map((group, i) => {
        if (!group.title) {
          return (
            <div key={i} className="space-y-0.5 pb-2">
              {group.items.map((item) => (
                <NavLink key={item.href} item={item} active={item.href === activeItem?.href} />
              ))}
            </div>
          );
        }
        const isOpen = group === activeGroup || !collapsed.has(group.title);
        return (
          <div key={i}>
            <button
              onClick={() => toggleGroup(group.title!)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between rounded-md px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-200"
            >
              {group.title}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? "" : "-rotate-90"}`} />
            </button>
            {isOpen && (
              <div className="space-y-0.5 pb-2">
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
    <Link href="/dashboard" className="mb-4 flex items-center gap-2 px-2 py-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">W</div>
      <span className="text-base font-semibold text-white">WorkEasy360</span>
    </Link>
  );

  return (
    <div className="flex min-h-screen flex-1 bg-slate-50">
      <a href="#main" className="sr-only z-50 rounded bg-white px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:left-2 focus:top-2">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto bg-[#0b1220] p-3 lg:flex">
        {brand}
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setDrawerOpen(false)} />
          <aside className="relative flex h-full w-64 flex-col overflow-y-auto bg-[#0b1220] p-3 shadow-xl">
            <div className="flex items-start justify-between">
              {brand}
              <button onClick={() => setDrawerOpen(false)} aria-label="Close menu" className="mt-2 rounded p-1 text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 py-2.5 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-500">
            <button onClick={() => setDrawerOpen(true)} aria-label="Open menu" className="-ml-1 rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden">
              <Menu className="h-5 w-5" />
            </button>
            {activeItem && (
              <>
                <activeItem.icon className="hidden h-4 w-4 shrink-0 text-slate-400 sm:block" strokeWidth={2} />
                {activeGroup && <span className="hidden truncate sm:inline">{activeGroup.title}</span>}
                {activeGroup && <span className="hidden text-slate-300 sm:inline">/</span>}
                <span className="truncate text-slate-900">{activeItem.label}</span>
              </>
            )}
          </div>

          <div className="flex items-center justify-end gap-1.5 sm:gap-3">
            <button
              onClick={() => setPaletteOpen(true)}
              className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 py-1.5 pl-2.5 pr-2 text-sm text-slate-400 hover:border-slate-300 sm:w-64"
              aria-label="Search"
            >
              <Search className="h-4 w-4" />
              <span className="hidden flex-1 text-left sm:inline">Search…</span>
              <kbd className="hidden rounded border border-slate-200 bg-white px-1.5 text-[10px] font-medium sm:inline">Ctrl K</kbd>
            </button>

            <ApprovalsBell open={bellOpen} setOpen={setBellOpen} />

            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="flex items-center gap-2 rounded-full py-1 pl-1 pr-1 hover:bg-slate-100 sm:pr-2"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">{initials}</div>
                <span className="hidden max-w-[10rem] truncate text-sm font-medium text-slate-700 md:inline">{displayName}</span>
                <ChevronDown className="hidden h-3.5 w-3.5 text-slate-400 md:block" />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-0" onClick={() => setMenuOpen(false)} />
                  <div role="menu" className="absolute right-0 top-full z-10 mt-2 w-64 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                    <div className="border-b border-slate-100 px-3 py-2.5">
                      <p className="truncate text-sm font-medium text-slate-900">{displayName}</p>
                      <p className="truncate text-xs text-slate-500">{user.email}</p>
                      {user.roles.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {user.roles.map((r) => (
                            <span key={r} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
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
                    <div className="my-1 border-t border-slate-100" />
                    <button
                      role="menuitem"
                      onClick={logout}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                    >
                      <LogOut className="h-4 w-4" strokeWidth={2} />
                      Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {user.mustChangePassword && pathname !== "/settings/security" && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 sm:px-6">
            <span>You&apos;re signed in with a temporary password. Choose your own to keep your account secure.</span>
            <Link href="/settings/security" className="font-medium text-amber-900 underline underline-offset-2">
              Set my password
            </Link>
          </div>
        )}

        <main id="main" className="mx-auto w-full max-w-7xl flex-1 p-4 text-slate-900 sm:p-6">
          {allowed ? (
            children
          ) : (
            <EmptyState
              icon={ShieldOff}
              title="You don't have access to this page"
              description="Ask your HR administrator if you think you should. In the meantime, here's the way back."
              action={
                <Link href="/dashboard" className="text-sm font-medium text-blue-600 hover:underline">
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
        className="relative rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-blue-600"
        aria-label={counts.total ? `${counts.total} pending approvals` : "Notifications"}
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" strokeWidth={2} />
        {counts.total > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {counts.total > 99 ? "99+" : counts.total}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-0" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-10 mt-2 w-72 rounded-lg border border-slate-200 bg-white shadow-lg">
            <p className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900">Waiting on you</p>
            {counts.total === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">You&apos;re all caught up.</p>
            ) : (
              <ul className="py-1">
                {rows
                  .filter((r) => counts[r.key] > 0)
                  .map((r) => (
                    <li key={r.key}>
                      <Link href="/approvals" className="flex items-center justify-between px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                        <span className="flex items-center gap-2">
                          <CheckSquare className="h-4 w-4 text-slate-400" /> {r.label}
                        </span>
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{counts[r.key]}</span>
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
            <Link href="/approvals" className="block border-t border-slate-100 px-4 py-2 text-center text-xs font-medium text-blue-600 hover:bg-slate-50">
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
    <Link role="menuitem" href={href} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900">
      <Icon className="h-4 w-4" strokeWidth={2} />
      {label}
    </Link>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
        active ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"
      }`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${active ? "text-white" : "text-slate-400 group-hover:text-white"}`} strokeWidth={2} />
      {item.label}
    </Link>
  );
}
