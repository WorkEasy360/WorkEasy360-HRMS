"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Bell,
  Building2,
  CheckSquare,
  ChevronDown,
  CircleHelp,
  Clock,
  LifeBuoy,
  Loader2,
  LogOut,
  Menu,
  MoreHorizontal,
  Search,
  ShieldCheck,
  ShieldOff,
  X,
} from "lucide-react";
import { AssistantPanel } from "@/components/AssistantPanel";
import { CommandPalette } from "@/components/CommandPalette";
import { useAuth } from "@/lib/auth-context";
import { ACCOUNT_NAV, findNavItem, isAdminView, mainNav, mobileNav, phoneTitle, type NavItem } from "@/lib/navigation";
import { usePendingApprovals, type PendingCounts } from "@/lib/use-pending-approvals";
import { apiFetch } from "@/lib/api";
import type { Organization } from "@/lib/types";
import { Avatar, IconButton, Lockup, ThemeToggle } from "@/ui";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout, hasPermission } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [orgName, setOrgName] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    apiFetch<Organization>("/organizations/current")
      .then((o) => setOrgName(o.name))
      .catch(() => setOrgName(null));
  }, [user]);

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
    setMoreOpen(false);
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

  // Seven menus for HR/Admin, five for everyone else. One flat list either way:
  // no nested groups, no separate manager system.
  const items = mainNav(hasPermission);
  const phoneItems = mobileNav(hasPermission);
  const isHome = pathname === "/dashboard";
  const displayName = user.employee ? `${user.employee.firstName} ${user.employee.lastName}` : user.email;
  // Under the name: their job title, else their role, else their employee code.
  const subline = user.employee?.designation ?? user.roles[0] ?? user.employee?.employeeCode ?? "";

  const sidebar = (
    <nav aria-label="Main" className="c-nav flex-1 gap-1.5 px-4 pb-6 pt-2">
      {items.map((item) => (
        <NavLink key={item.href} item={item} active={item.href === activeItem?.href} />
      ))}
    </nav>
  );

  const brand = (
    <Link href="/dashboard" className="flex shrink-0 justify-center px-5 pb-6 pt-6" aria-label="WorkEasy360 HRMS home">
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
        className="c-sidebar sticky top-0 hidden h-screen w-sidebar shrink-0 flex-col overflow-y-auto shell:flex"
      >
        {brand}
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 shell:hidden">
          <div className="c-scrim" onClick={() => setDrawerOpen(false)} />
          <aside data-region="primary" className="c-drawer c-sidebar">
            <div className="flex items-start justify-between">
              {brand}
              <IconButton icon={X} onClick={() => setDrawerOpen(false)} aria-label="Close menu" className="mt-2 mr-2" />
            </div>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phone app bar (the Android app and phone browsers): the brand on
            Home, otherwise back + the screen's name, as in the app design. */}
        <header className="c-appbar shell:hidden">
          {isHome ? (
            <>
              <button type="button" className="c-appbar-btn" onClick={() => setDrawerOpen(true)} aria-label="Open menu">
                <Menu strokeWidth={2} aria-hidden />
              </button>
              <Link href="/dashboard" className="flex min-w-0 flex-1 items-center" aria-label="WorkEasy360 HRMS home">
                <Lockup onDark layout="inline" className="c-appbar-lockup" />
              </Link>
            </>
          ) : (
            <>
              <button
                type="button"
                className="c-appbar-btn"
                aria-label="Back"
                onClick={() => (window.history.length > 1 ? router.back() : router.push("/dashboard"))}
              >
                <ArrowLeft strokeWidth={2} aria-hidden />
              </button>
              <h1 className="c-appbar-title">{phoneTitle(pathname, isAdminView(hasPermission))}</h1>
            </>
          )}
          <ApprovalsBell open={bellOpen} setOpen={setBellOpen} />
        </header>

        <header className="sticky top-0 z-30 hidden h-topbar shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 sm:px-6 shell:flex">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <IconButton icon={Menu} onClick={() => setDrawerOpen(true)} aria-label="Open menu" className="-ml-2 shell:hidden" />

            {/* The organization. Everyone belongs to exactly one here, so this
                is a label, not a switcher (the note: a switcher only when needed). */}
            {orgName && (
              <span className="c-org-chip hidden min-w-0 sm:inline-flex" title={orgName}>
                <Building2 strokeWidth={2} aria-hidden />
                <span className="truncate">{orgName}</span>
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <button onClick={() => setPaletteOpen(true)} className="c-topbar-icon" aria-label="Search (Ctrl K)">
              <Search strokeWidth={2} aria-hidden />
            </button>
            <ApprovalsBell open={bellOpen} setOpen={setBellOpen} />
            <Link href="/helpdesk" className="c-topbar-icon hidden sm:inline-flex" aria-label="Help">
              <CircleHelp strokeWidth={2} aria-hidden />
            </Link>
            <span className="hidden sm:contents">
              <ThemeToggle />
            </span>

            <span aria-hidden className="mx-1 hidden h-8 w-px bg-line sm:block" />

            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={`Account menu for ${displayName}`}
                className="flex items-center gap-3 rounded-full p-1 hover:bg-muted sm:pr-2"
              >
                <Avatar name={displayName} />
                <span className="hidden min-w-0 text-left md:block">
                  <span className="block max-w-44 truncate text-sm font-semibold text-heading">{displayName}</span>
                  {subline && <span className="block max-w-44 truncate text-xs text-secondary">{subline}</span>}
                </span>
                <ChevronDown className="hidden size-4 text-heading md:block" aria-hidden />
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
                    {/* Own-record pages, so HR and admins can still reach
                        their own details without an eighth menu. */}
                    {ACCOUNT_NAV.map((item) => (
                      <MenuLink key={item.href} href={item.href} icon={item.icon} label={item.label} />
                    ))}
                    <MenuLink
                      href="/settings?tab=account"
                      icon={user.totpEnabled ? ShieldCheck : ShieldOff}
                      label={user.totpEnabled ? "Account & security" : "Account & security · turn on 2FA"}
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

        {user.mustChangePassword && !pathname.startsWith("/settings") && (
          <div className="px-4 pt-4 sm:px-6">
            <div className="c-alert" data-tone="warning">
              <span>You&apos;re signed in with a temporary password. Choose your own to keep your account secure.</span>
              <Link href="/settings?tab=account" className="c-link shrink-0">
                Set my password
              </Link>
            </div>
          </div>
        )}

        {/* Step 1 of the page contract, hoisted here so no page can forget it.
            Extra bottom padding on mobile keeps the bottom bar clear of content. */}
        <main id="main" className="c-page flex-1 pb-24 shell:pb-0">
          {children}
        </main>
      </div>

      {/* Phone bottom navigation: four screens for the role, then More. */}
      <nav aria-label="Primary" className="c-bottom-nav shell:hidden">
        {phoneItems.map((item) => (
          <BottomLink key={item.href} item={item} pathname={pathname} />
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className="c-bottom-item"
        >
          <MoreHorizontal strokeWidth={2} aria-hidden />
          More
        </button>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-40 shell:hidden">
          <div className="c-scrim" onClick={() => setMoreOpen(false)} />
          <div role="dialog" aria-label="More" className="c-sheet">
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-3">
                <Avatar name={displayName} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-heading">{displayName}</span>
                  <span className="block truncate text-xs text-secondary">{orgName ?? user.email}</span>
                </span>
              </span>
              <IconButton icon={X} onClick={() => setMoreOpen(false)} aria-label="Close" />
            </div>
            <div className="c-nav mt-3">
              {/* The same screens, not separate mobile workflows. */}
              {[...items.filter((i) => !phoneItems.some((m) => m.href === i.href)), ...ACCOUNT_NAV]
                .filter((item, i, all) => all.findIndex((x) => x.href === item.href) === i)
                .map((item) => (
                  <NavLink key={item.href} item={item} active={item.href === activeItem?.href} />
                ))}
              <Link href="/settings?tab=account" className="c-nav-item">
                {user.totpEnabled ? <ShieldCheck strokeWidth={2} aria-hidden /> : <ShieldOff strokeWidth={2} aria-hidden />}
                Account &amp; security
              </Link>
              <div className="flex items-center justify-between px-3 py-2 text-sm text-body">
                Theme
                <ThemeToggle />
              </div>
              <button type="button" onClick={logout} className="c-nav-item text-danger-text">
                <LogOut strokeWidth={2} aria-hidden />
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
      <AssistantPanel />
    </div>
  );
}

/**
 * What is waiting on this person (Home 1.1.3). Links into the page that owns
 * each kind of request: there is no separate Approvals screen.
 */
function ApprovalsBell({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const counts = usePendingApprovals();
  const rows: { key: keyof PendingCounts; label: string; href: string; icon: NavItem["icon"] }[] = [
    { key: "leave", label: "Leave requests", href: "/attendance?tab=leave", icon: CheckSquare },
    { key: "corrections", label: "Attendance corrections", href: "/attendance?tab=corrections", icon: Clock },
    { key: "tickets", label: "Open tickets in your queue", href: "/helpdesk?tab=queue", icon: LifeBuoy },
  ];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="c-topbar-icon"
        aria-label={counts.total ? `${counts.total} items waiting on you` : "Notifications"}
        aria-expanded={open}
      >
        <Bell strokeWidth={2} aria-hidden />
        {counts.total > 0 && <span className="c-topbar-dot" aria-hidden />}
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
                      <Link href={r.href} className="c-menu-item justify-between">
                        <span className="flex items-center gap-2">
                          <r.icon strokeWidth={2} aria-hidden /> {r.label}
                        </span>
                        <span className="c-badge" data-tone="warning">
                          {counts[r.key]}
                        </span>
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
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

function BottomLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = item.icon;
  const [path, query] = item.href.split("?");
  // "Attendance" and "Leave" are two ways into the same screen, so only the
  // plain path lights up for the bare page.
  const active = pathname === path && !query;
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} className="c-bottom-item">
      <Icon strokeWidth={2} aria-hidden />
      {item.label}
    </Link>
  );
}
