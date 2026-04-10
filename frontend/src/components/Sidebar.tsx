"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Clock, GitBranch, Network, Settings } from "lucide-react";

const NAV = [
  { href: "/incidents", label: "Incidents", icon: Activity },
  { href: "/history", label: "History", icon: Clock },
  { href: "/topology", label: "Topology", icon: Network },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="w-56 flex-shrink-0 bg-[#13131a] border-r border-slate-800 flex flex-col">
      <div className="px-5 py-5 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <GitBranch className="text-indigo-400" size={20} />
          <span className="font-semibold text-lg tracking-tight text-white">sre.ai</span>
        </div>
        <p className="text-xs text-slate-500 mt-0.5">AI Site Reliability Engineer</p>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                active
                  ? "bg-indigo-600/20 text-indigo-300"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              }`}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="px-5 py-3 border-t border-slate-800">
        <p className="text-xs text-slate-600">Powered by Claude</p>
      </div>
    </aside>
  );
}
