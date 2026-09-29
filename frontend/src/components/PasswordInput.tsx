"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  required,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: "current-password" | "new-password";
  required?: boolean;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required={required}
        placeholder={placeholder}
        maxLength={128}
        className="input pr-10"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

/** Mirrors the backend policy: 10+ characters with at least one letter and one number. */
export function passwordIssues(password: string): string[] {
  const issues: string[] = [];
  if (password.length < 10) issues.push("10+ characters");
  if (!/[A-Za-z]/.test(password)) issues.push("a letter");
  if (!/[0-9]/.test(password)) issues.push("a number");
  return issues;
}

export function PasswordStrength({ password }: { password: string }) {
  if (!password) return <p className="mt-1 text-xs text-slate-500">At least 10 characters, with a letter and a number.</p>;
  const issues = passwordIssues(password);
  const score = Math.min(4, (issues.length === 0 ? 2 : 0) + (password.length >= 14 ? 1 : 0) + (/[^A-Za-z0-9]/.test(password) ? 1 : 0));
  const colors = ["bg-red-500", "bg-amber-500", "bg-amber-500", "bg-emerald-500", "bg-emerald-600"];
  const labels = ["Too weak", "Okay", "Good", "Strong", "Very strong"];
  return (
    <div className="mt-1.5" aria-live="polite">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`h-1 flex-1 rounded-full ${i < Math.max(1, score) ? colors[score] : "bg-slate-200"}`} />
        ))}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {issues.length ? `Still needs ${issues.join(", ")}.` : labels[score]}
      </p>
    </div>
  );
}
