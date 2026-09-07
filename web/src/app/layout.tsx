import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Header } from "@/components/Header";
import { I18nProvider } from "@/i18n/context";
import { getServerLocale } from "@/i18n/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "QCaaS",
  description: "Quantum circuit optimisation, cost estimation and business-language interpretation as an API.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getServerLocale();
  return (
    <html lang={locale} className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-slate-50 text-slate-900">
        <I18nProvider initialLocale={locale}>
          <Header />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
          <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-500">
            © {new Date().getFullYear()} QCaaS
          </footer>
        </I18nProvider>
      </body>
    </html>
  );
}
