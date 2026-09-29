import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'SSE Resume Example - Next.js',
  description: 'Next.js App Router with SSE live resume',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
