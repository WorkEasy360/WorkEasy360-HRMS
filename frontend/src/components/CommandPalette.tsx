"use client";

import { CornerDownLeft, Search, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { ALL_NAV_ITEMS, canSee, type NavItem } from "@/lib/navigation";
import type { Employee } from "@/lib/types";

type Result =
  | { kind: "page"; item: NavItem }
  | { kind: "person"; employee: Employee };

/** Mounted only while open, so its state starts fresh each time. */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { hasPermission } = useAuth();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Employee[]>([]);
  const [active, setActive] = useState(0);
  const canSearchPeople = hasPermission("employee:read");
  const peopleQuery = canSearchPeople && query.trim().length >= 2 ? query.trim() : "";

  // Debounced people search.
  useEffect(() => {
    if (!peopleQuery) return;
    const handle = setTimeout(() => {
      apiFetch<Employee[]>(`/employees?search=${encodeURIComponent(peopleQuery)}`)
        .then((data) => setPeople(data.slice(0, 5)))
        .catch(() => setPeople([]));
    }, 200);
    return () => clearTimeout(handle);
  }, [peopleQuery]);

  const results: Result[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pages = ALL_NAV_ITEMS.filter((i) => canSee(i, hasPermission)).filter(
      (i) => !q || `${i.label} ${i.description} ${i.keywords ?? ""}`.toLowerCase().includes(q),
    );
    return [
      ...pages.slice(0, q ? 8 : 6).map((item) => ({ kind: "page" as const, item })),
      ...(peopleQuery ? people : []).map((employee) => ({ kind: "person" as const, employee })),
    ];
  }, [query, people, peopleQuery, hasPermission]);

  function go(r: Result) {
    router.push(r.kind === "page" ? r.item.href : `/people/${r.employee.id}`);
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      go(results[active]);
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-[12vh]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-4">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={canSearchPeople ? "Search pages or people…" : "Search pages…"}
            className="flex-1 bg-transparent py-3.5 text-sm outline-none placeholder:text-slate-400"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={results[active] ? `palette-${active}` : undefined}
          />
          <kbd className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-400">ESC</kbd>
        </div>
        <ul id="palette-results" role="listbox" className="max-h-80 overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">No matches for &ldquo;{query}&rdquo;</li>}
          {results.map((r, i) => {
            const selected = i === active;
            const Icon = r.kind === "page" ? r.item.icon : UserRound;
            const firstPerson = r.kind === "person" && (i === 0 || results[i - 1].kind === "page");
            return (
              <li key={r.kind === "page" ? r.item.href : r.employee.id}>
                {firstPerson && <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">People</p>}
                <button
                  id={`palette-${i}`}
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(r)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${selected ? "bg-blue-50 text-blue-900" : "text-slate-700"}`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${selected ? "text-blue-600" : "text-slate-400"}`} />
                  <span className="flex-1 truncate">
                    <span className="font-medium">
                      {r.kind === "page" ? r.item.label : `${r.employee.firstName} ${r.employee.lastName}`}
                    </span>
                    <span className="ml-2 text-xs text-slate-500">
                      {r.kind === "page" ? r.item.description : [r.employee.designation, r.employee.employeeCode].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {selected && <CornerDownLeft className="h-3.5 w-3.5 text-blue-400" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
