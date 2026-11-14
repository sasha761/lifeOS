import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "LifeOS — пространство развития", template: "%s · LifeOS" },
  description: "Личное пространство развития в сферах Languages, Finance, Work, Projects, Skills и Health.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <a href="#main-content" className="fixed top-3 left-3 z-50 -translate-y-24 rounded-lg bg-primary px-4 py-3 font-medium text-primary-foreground focus:translate-y-0">
          К содержимому
        </a>
        {children}
      </body>
    </html>
  );
}
