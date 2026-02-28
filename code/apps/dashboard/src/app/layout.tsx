import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Insight Engine — Dashboard',
  description: 'Content approval dashboard for The Insight Engine',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
