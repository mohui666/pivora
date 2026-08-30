import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import 'react-grid-layout/css/styles.css';
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
  title: 'Pivora — Local-first analytics studio',
  description:
    'Model local data, query it with SQL, and build interactive dashboards without uploading a row.',
  openGraph: {
    title: 'Pivora — Local-first analytics studio',
    description: 'Your data. Your device. Clear answers.',
    images: ['/pivora-og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pivora — Local-first analytics studio',
    description: 'Your data. Your device. Clear answers.',
    images: ['/pivora-og.png'],
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
