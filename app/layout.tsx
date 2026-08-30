import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'LocalLens BI — Local-first analytics',
  description:
    'Turn local CSV files into interactive dashboards without uploading your data.',
  openGraph: {
    title: 'LocalLens BI — Local-first analytics',
    description: 'Your data. Your device. Clear answers.',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'LocalLens BI — Local-first analytics',
    description: 'Your data. Your device. Clear answers.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
