import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import QueryProvider from "@/components/QueryProvider";

export const metadata: Metadata = {
  title: "Roboko",
  description: "Roboko Tournament Management Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply saved theme before first paint — no flash of Terminal on reload. */}
        <Script
          id="roboko-theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('roboko-theme');document.documentElement.dataset.theme=(t==='ember')?'ember':'terminal';}catch(e){document.documentElement.dataset.theme='terminal';}})()`,
          }}
        />
      </head>
      <body className="antialiased">
        <AuthProvider>
          <QueryProvider>
            {children}
          </QueryProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
