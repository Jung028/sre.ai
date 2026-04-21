"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BookOpen, GitFork, Settings, Zap } from "lucide-react";

const NAV = [
  { href: "/incidents", label: "Incidents",  icon: Activity  },
  { href: "/traces",    label: "Trace",      icon: GitFork   },
  { href: "/runbooks",  label: "Runbooks",   icon: BookOpen  },
  { href: "/settings",  label: "Settings",   icon: Settings  },
];

export function Sidebar() {
  const path = usePathname();

  return (
    <aside className="w-56 flex-shrink-0 flex flex-col bg-[var(--bg-sidebar)] border-r border-slate-800/80">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center flex-shrink-0">
            <Zap size={14} className="text-white" />
          </div>
          <span className="font-bold text-base tracking-tight text-white">sre.ai</span>
        </div>
        <p className="text-[11px] text-slate-600 mt-1.5 pl-0.5">AI Site Reliability Engineer</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = path === href || (href !== "/" && path.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-indigo-600/15 text-indigo-300 border border-indigo-500/20"
                  : "text-slate-500 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent"
              }`}
            >
              <Icon size={15} className={active ? "text-indigo-400" : ""} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-slate-800/80">
        <p className="text-[11px] text-slate-700 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
          Powered by Claude
        </p>
      </div>
    </aside>
  );
}
