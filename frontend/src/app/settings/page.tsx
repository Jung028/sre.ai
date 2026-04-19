"use client";

import { Settings } from "lucide-react";

const INTEGRATIONS = [
  { name: "Anthropic Claude", env: "ANTHROPIC_API_KEY", desc: "AI investigation engine" },
  { name: "PagerDuty", env: "PAGERDUTY_WEBHOOK_SECRET", desc: "Alert ingestion" },
  { name: "Datadog", env: "DATADOG_API_KEY", desc: "Logs & metrics" },
  { name: "Grafana", env: "GRAFANA_URL", desc: "Metrics & alerting" },
  { name: "Slack", env: "SLACK_BOT_TOKEN", desc: "RCA notifications" },
  { name: "GitHub", env: "GITHUB_TOKEN", desc: "Auto PR creation" },
];

export default function SettingsPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Settings className="text-indigo-400" size={20} />
        <h1 className="text-xl font-semibold text-white">Settings & Integrations</h1>
      </div>

      <div className="bg-[var(--bg-surface)] border border-slate-800 rounded-xl overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-slate-800">
          <h2 className="text-sm font-medium text-slate-200">Integration Status</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Configure via environment variables in <code className="text-slate-400">.env</code>
          </p>
        </div>
        <div className="divide-y divide-slate-800">
          {INTEGRATIONS.map((i) => (
            <div key={i.name} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="text-sm text-slate-200">{i.name}</p>
                <p className="text-xs text-slate-500">{i.desc}</p>
              </div>
              <code className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded">
                {i.env}
              </code>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-[var(--bg-surface)] border border-slate-800 rounded-xl p-5">
        <h2 className="text-sm font-medium text-slate-200 mb-3">Webhook Endpoints</h2>
        <div className="space-y-2">
          {["pagerduty", "datadog", "grafana"].map((src) => (
            <div key={src} className="flex items-center gap-3">
              <span className="text-xs text-slate-500 w-20 capitalize">{src}</span>
              <code className="text-xs text-indigo-400 bg-slate-800/50 px-2 py-1 rounded flex-1">
                POST /api/webhooks/{src}
              </code>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
