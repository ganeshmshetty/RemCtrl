import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Navbar from "@/components/Navbar";
import { GithubIcon, AppleIcon, WindowsIcon } from "@/components/Icons";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "RemoteCtrl | Open Source Browser Automation",
  description: "Objective automation. An open-source Electron desktop application for AI agent execution.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} antialiased`} suppressHydrationWarning>
      <body className="relative text-swiss-black bg-swiss-white min-h-screen border-x-4 border-swiss-black mx-auto max-w-[1440px]" suppressHydrationWarning>
        {/* Global Noise Overlay */}
        <div className="swiss-noise" aria-hidden="true" />
        
        {/* Navigation */}
        <Navbar />

        {children}

        {/* Footer */}
        <footer className="border-t-4 border-swiss-black bg-swiss-white py-12 md:py-24 px-8 md:px-16 text-center md:text-left">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            <div>
              <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase mb-6">Free &amp; Open.</h2>
              <p className="text-lg md:text-xl max-w-md font-medium mx-auto md:mx-0">RemoteCtrl is open-source and built for developers who demand objective clarity and uncompromising control over browser automation.</p>
            </div>
            <div className="flex flex-col md:flex-row justify-end items-center md:items-end gap-8 font-bold uppercase tracking-widest text-sm">
              <div className="flex flex-col gap-4 text-center md:text-right items-center md:items-end">
                <a href="https://github.com/ganeshmshetty/RemCtrl" target="_blank" rel="noopener noreferrer" className="hover:text-swiss-accent transition-colors flex items-center gap-2">
                  <GithubIcon className="w-4 h-4 text-swiss-black" />
                  GitHub Repository
                </a>
                <a href="/docs" className="hover:text-swiss-accent transition-colors">Documentation</a>
                <a href="#" className="hover:text-swiss-accent transition-colors flex items-center gap-2">
                  <AppleIcon className="w-4 h-4" />
                  Download macOS
                </a>
                <a href="#" className="hover:text-swiss-accent transition-colors flex items-center gap-2">
                  <WindowsIcon className="w-4 h-4" />
                  Download Windows
                </a>
              </div>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
