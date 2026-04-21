"use client";

// Theme is dark-only. This file kept as a stub so imports don't break.
export function useTheme() {
  return { theme: "dark" as const, toggle: () => {} };
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
