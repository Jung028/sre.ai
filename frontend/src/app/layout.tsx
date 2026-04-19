import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: "sre.ai — AI Site Reliability Engineer",
  description: "AI-powered incident investigation and root cause analysis",
};

// Inline script runs synchronously before React hydration to prevent theme flash.
// Sets or removes the .dark class based on localStorage preference.
const themeScript = `
(function(){
  try {
    var t = localStorage.getItem('sre-theme');
    if (t === 'light') {
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
    }
  } catch(e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex h-screen overflow-hidden bg-[var(--bg-base)] text-slate-900 dark:text-slate-100">
        <ThemeProvider>
          <Sidebar />
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
