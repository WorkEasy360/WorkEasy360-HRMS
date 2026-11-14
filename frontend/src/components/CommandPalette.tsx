"use client";

import { CornerDownLeft, Search, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { searchableNav, type NavItem } from "@/lib/navigation";
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
    const pages = searchableNav(hasPermission).filter(
      (i) => !q || `${i.label} ${i.description} ${i.keywords ?? ""}`.toLowerCase().includes(q),
    );
    return [
      ...pages.slice(0, q ? 8 : 6).map((item) => ({ kind: "page" as const, item })),
      ...(peopleQuery ? people : []).map((employee) => ({ kind: "person" as const, employee })),
    ];
  }, [query, people, peopleQuery, hasPermission]);

  function go(r: Result) {
    router.push(r.kind === "page" ? r.item.href : `/employees/${r.employee.id}`);
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
    <div className="c-dialog items-start pt-[12vh] z-50" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="c-dialog-panel max-w-lg overflow-hidden p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search className="size-4 text-secondary" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={canSearchPeople ? "Search pages or people…" : "Search pages…"}
            className="flex-1 bg-transparent py-3.5 text-sm text-heading outline-none placeholder:text-secondary"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={results[active] ? `palette-${active}` : undefined}
          />
          <kbd className="c-kbd">ESC</kbd>
        </div>
        <ul id="palette-results" role="listbox" className="c-listbox">
          {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-secondary">No matches for &ldquo;{query}&rdquo;</li>}
          {results.map((r, i) => {
            const selected = i === active;
            const Icon = r.kind === "page" ? r.item.icon : UserRound;
            const firstPerson = r.kind === "person" && (i === 0 || results[i - 1].kind === "page");
            return (
              <li key={r.kind === "page" ? r.item.href : r.employee.id}>
                {firstPerson && <p className="c-eyebrow px-3 pb-1 pt-2">People</p>}
                <button
                  id={`palette-${i}`}
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(r)}
                  className="c-listbox-option"
                >
                  <Icon className={`size-4 shrink-0 ${selected ? "text-accent-strong" : "text-secondary"}`} aria-hidden />
                  <span className="flex-1 truncate">
                    <span className="font-medium">
                      {r.kind === "page" ? r.item.label : `${r.employee.firstName} ${r.employee.lastName}`}
                    </span>
                    <span className="ml-2 text-xs text-secondary">
                      {r.kind === "page" ? r.item.description : [r.employee.designation, r.employee.employeeCode].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {selected && <CornerDownLeft className="size-3.5 text-secondary" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
