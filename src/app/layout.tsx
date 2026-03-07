import type { Metadata } from 'next'
import { Playfair_Display, DM_Sans, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
})

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
  weight: ['400', '500'],
})

export const metadata: Metadata = {
  title: 'Global Job Engine — High-Value International Jobs',
  description: 'Automated discovery of high-value international jobs with visa sponsorship, remote opportunities, and startup roles. Updated every 30 minutes.',
  keywords: 'remote jobs, visa sponsorship, international jobs, startup jobs, high salary jobs, software engineer jobs',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${playfair.variable} ${dmSans.variable} ${jetbrainsMono.variable}`}>
      <body className="font-body bg-surface-0 text-text-primary antialiased">
        {children}
      </body>
    </html>
  )
}
