"use client";

import { useState } from "react";
import { Menu, X, ExternalLink } from "lucide-react";
import { GithubIcon } from "@/components/Icons";

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);

  const toggleMenu = () => setIsOpen(!isOpen);

  return (
    <nav className="sticky top-0 z-40 flex flex-col md:flex-row justify-between border-b-4 border-swiss-black bg-swiss-white">
      {/* Brand logo & mobile toggle */}
      <div className="p-4 md:p-6 border-b-4 md:border-b-0 md:border-r-4 border-swiss-black flex items-center justify-between bg-swiss-white hover:bg-swiss-black hover:text-swiss-white transition-colors duration-150 group cursor-pointer">
        <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tighter group-hover:scale-105 transition-transform duration-150">
          <a href="/">RemoteCtrl</a>
        </h1>
        {/* Mobile menu button */}
        <button 
          onClick={toggleMenu} 
          className="md:hidden p-2 border-2 border-swiss-black hover:bg-swiss-accent hover:text-swiss-white transition-colors"
          aria-label={isOpen ? "Close menu" : "Open menu"}
        >
          {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Nav Links */}
      <div className={`${isOpen ? "flex" : "hidden"} md:flex flex-col md:flex-row w-full md:w-auto transition-all duration-200`}>
        <a 
          href="/#features" 
          onClick={() => setIsOpen(false)}
          className="group relative px-6 py-4 md:py-6 border-b-4 md:border-b-0 md:border-r-4 border-swiss-black font-bold uppercase tracking-widest text-sm flex items-center overflow-hidden bg-swiss-white"
        >
          <span className="relative z-10 group-hover:-translate-y-10 transition-transform duration-200 ease-out flex items-center">
            <span className="text-swiss-accent mr-2">01.</span> Features
          </span>
          <span className="absolute inset-0 bg-swiss-accent text-swiss-white flex items-center px-6 translate-y-full group-hover:translate-y-0 transition-transform duration-200 ease-out z-20">
            <span className="mr-2 text-swiss-white">01.</span> Features
          </span>
        </a>
        <a 
          href="/#use-cases" 
          onClick={() => setIsOpen(false)}
          className="group relative px-6 py-4 md:py-6 border-b-4 md:border-b-0 md:border-r-4 border-swiss-black font-bold uppercase tracking-widest text-sm flex items-center overflow-hidden bg-swiss-white"
        >
          <span className="relative z-10 group-hover:-translate-y-10 transition-transform duration-200 ease-out flex items-center">
            <span className="text-swiss-accent mr-2">02.</span> Use Cases
          </span>
          <span className="absolute inset-0 bg-swiss-accent text-swiss-white flex items-center px-6 translate-y-full group-hover:translate-y-0 transition-transform duration-200 ease-out z-20">
            <span className="mr-2 text-swiss-white">02.</span> Use Cases
          </span>
        </a>
        <a 
          href="/docs" 
          onClick={() => setIsOpen(false)}
          className="group relative px-6 py-4 md:py-6 border-b-4 md:border-b-0 md:border-r-4 border-swiss-black font-bold uppercase tracking-widest text-sm flex items-center overflow-hidden bg-swiss-white"
        >
          <span className="relative z-10 group-hover:-translate-y-10 transition-transform duration-200 ease-out flex items-center">
            <span className="text-swiss-accent mr-2">03.</span> Docs
          </span>
          <span className="absolute inset-0 bg-swiss-accent text-swiss-white flex items-center px-6 translate-y-full group-hover:translate-y-0 transition-transform duration-200 ease-out z-20">
            <span className="mr-2 text-swiss-white">03.</span> Docs
          </span>
        </a>
        <a 
          href="https://github.com/ganeshmshetty/RemCtrl" 
          target="_blank" 
          rel="noopener noreferrer" 
          className="group relative px-6 py-4 md:py-6 border-b-4 md:border-b-0 md:last:border-r-0 border-swiss-black font-bold uppercase tracking-widest text-sm flex items-center overflow-hidden bg-swiss-white"
        >
          <span className="relative z-10 group-hover:-translate-y-10 transition-transform duration-200 ease-out flex items-center gap-2">
            <span className="text-swiss-accent mr-2">04.</span> Source 
            <GithubIcon className="w-4 h-4 text-swiss-black animate-pulse" />
            <ExternalLink className="w-3 h-3 text-swiss-accent" />
          </span>
          <span className="absolute inset-0 bg-swiss-accent text-swiss-white flex items-center px-6 translate-y-full group-hover:translate-y-0 transition-transform duration-200 ease-out z-20 gap-2">
            <span className="mr-2 text-swiss-white">04.</span> Source 
            <GithubIcon className="w-4 h-4 text-swiss-white" />
            <ExternalLink className="w-3 h-3 text-swiss-white" />
          </span>
        </a>
      </div>
    </nav>
  );
}
