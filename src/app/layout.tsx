import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Emerging Defense Solutions | Unified SMB Cyber, Legal & R&D Portal',
  description: 'Continuous Cyber Defense, Notary & Process Server Readiness, and Applied Doctoral R&D Lab.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased selection:bg-emerald-500/30 selection:text-emerald-200">
        {children}
      </body>
    </html>
  );
}