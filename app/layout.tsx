import type { Metadata } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
});

export const metadata: Metadata = {
  title: 'Shipyard Equipment & Maintenance Hub',
  description: 'Shipyard asset management and maintenance dashboard',
};

import { DataProvider } from '@/context/DataContext';
import { Providers } from './providers';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body suppressHydrationWarning className="bg-slate-50 text-slate-900 font-sans">
        <Providers>
          <DataProvider>
            {children}
          </DataProvider>
        </Providers>
      </body>
    </html>
  );
}
