import { ArrowRight, Box, Circle, Plus, Square, Terminal, Globe, MousePointerClick } from "lucide-react";
import { GithubIcon, AppleIcon, WindowsIcon } from "@/components/Icons";

export default function Home() {
  return (
    <main className="flex flex-col w-full relative">
      {/* Hero Section */}
      <section className="relative min-h-[90vh] flex flex-col items-center justify-center px-8 py-24 md:p-24 overflow-hidden bg-swiss-muted swiss-grid-pattern border-b-4 border-swiss-black">
        {/* Abstract Geometric Background */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden flex justify-center items-center opacity-10 md:opacity-20">
          <div className="w-[40vw] h-[40vw] border-[12px] border-swiss-black rounded-full absolute -top-20 -left-20 mix-blend-multiply" />
          <div className="w-[50vw] h-[50vw] border-[12px] border-swiss-accent absolute bottom-10 right-10 mix-blend-multiply rotate-12" />
        </div>

        <div className="relative z-10 max-w-6xl w-full text-center md:text-left flex flex-col md:flex-row gap-12 items-center">
          <div className="flex-1 space-y-8">
            <h1 className="text-6xl md:text-[8rem] leading-[0.85] font-black tracking-tighter uppercase break-words">
              Remote.<br />
              <span className="text-swiss-accent">Browser.</span><br />
              Control.
            </h1>
            <p className="text-xl md:text-3xl max-w-2xl font-medium border-l-4 border-swiss-black pl-6 py-2 mx-auto md:mx-0">
              Objective automation. A playful, powerful, open-source Electron desktop application for AI agent execution.
            </p>
            <div className="flex flex-col sm:flex-row flex-wrap gap-4 pt-8 justify-center md:justify-start">
              <a href="#" className="group flex items-center justify-center px-6 py-4 bg-swiss-black text-swiss-white font-bold uppercase tracking-widest hover:bg-swiss-accent transition-colors duration-150 border-4 border-swiss-black gap-3 text-sm">
                <AppleIcon className="w-5 h-5" />
                macOS
              </a>
              <a href="#" className="group flex items-center justify-center px-6 py-4 bg-swiss-black text-swiss-white font-bold uppercase tracking-widest hover:bg-swiss-accent transition-colors duration-150 border-4 border-swiss-black gap-3 text-sm">
                <WindowsIcon className="w-5 h-5" />
                Windows
              </a>
              <a href="https://github.com/ganeshmshetty/RemCtrl" target="_blank" rel="noopener noreferrer" className="group flex items-center justify-center px-6 py-4 bg-swiss-white text-swiss-black font-bold uppercase tracking-widest hover:bg-swiss-black hover:text-swiss-white transition-colors duration-150 border-4 border-swiss-black gap-3 text-sm">
                <GithubIcon className="w-5 h-5" />
                GitHub
              </a>
            </div>
          </div>
          
          <div className="flex-1 hidden md:flex justify-center items-center relative">
            {/* Playful Composition */}
            <div className="relative w-96 h-96 group">
              <div className="absolute inset-0 bg-swiss-white border-4 border-swiss-black shadow-[16px_16px_0px_0px_rgba(0,0,0,1)] transition-transform duration-200 group-hover:-translate-y-2 group-hover:-translate-x-2 flex flex-col">
                <div className="h-12 border-b-4 border-swiss-black bg-swiss-muted flex items-center px-4 space-x-2">
                  <div className="w-3 h-3 rounded-full border-2 border-swiss-black bg-swiss-white" />
                  <div className="w-3 h-3 rounded-full border-2 border-swiss-black bg-swiss-white" />
                  <div className="w-3 h-3 rounded-full border-2 border-swiss-black bg-swiss-accent" />
                </div>
                <div className="flex-1 swiss-dots flex items-center justify-center relative overflow-hidden">
                  <Circle className="w-32 h-32 text-swiss-accent absolute -left-8 -bottom-8 stroke-[3]" />
                  <Square className="w-24 h-24 text-swiss-black absolute top-10 right-10 stroke-[4] rotate-12" />
                  <div className="bg-swiss-black text-swiss-white px-4 py-2 font-bold uppercase tracking-widest border-2 border-swiss-black rotate-[-5deg] z-10 group-hover:rotate-0 transition-transform duration-150 group-hover:bg-swiss-accent group-hover:scale-110">
                    Agent Active
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Marquee Banner */}
      <div className="w-full overflow-hidden border-b-4 border-swiss-black bg-swiss-accent text-swiss-white py-4 flex whitespace-nowrap">
        <div className="animate-marquee font-black uppercase text-4xl tracking-tighter flex items-center">
          <span className="mx-8">Open Source</span>
          <Plus className="w-8 h-8" />
          <span className="mx-8">Playwright Native</span>
          <Plus className="w-8 h-8" />
          <span className="mx-8">AI Execution Engine</span>
          <Plus className="w-8 h-8" />
          <span className="mx-8">WebRTC Streaming</span>
          <Plus className="w-8 h-8" />
          <span className="mx-8">Open Source</span>
          <Plus className="w-8 h-8" />
          <span className="mx-8">Playwright Native</span>
          <Plus className="w-8 h-8" />
          <span className="mx-8">AI Execution Engine</span>
          <Plus className="w-8 h-8" />
        </div>
      </div>

      {/* Section 01: Features */}
      <section id="features" className="grid grid-cols-1 lg:grid-cols-[7fr_5fr] border-b-4 border-swiss-black bg-swiss-white">
        <div className="grid grid-cols-1 sm:grid-cols-2 bg-swiss-muted border-r-4 border-swiss-black order-2 lg:order-1">
          {[
            {
              title: "AI Agent Loop",
              desc: "A core step-by-step reasoning engine generating executable tool actions directly in the browser."
            },
            {
              title: "Playwright Integration",
              desc: "Native browser wrappers for precise interactions: goto, act, observe, extract, scroll, and type."
            },
            {
              title: "Visual Cursor Overlays",
              desc: "Stagehand-inspired script injection showing you exactly where the AI is clicking and looking."
            },
            {
              title: "WebRTC Streaming",
              desc: "Low-latency peer-to-peer screen capture. Watch your agent work from any device securely."
            }
          ].map((feat, i) => (
            <div key={i} className="group p-8 md:p-12 border-b-4 border-swiss-black sm:odd:border-r-4 sm:[&:nth-last-child(-n+2)]:border-b-0 bg-swiss-white hover:bg-swiss-black hover:text-swiss-white transition-colors duration-150 cursor-crosshair flex flex-col justify-center h-full">
              <h3 className="text-xl font-bold uppercase tracking-tight mb-2 group-hover:text-swiss-accent">{feat.title}</h3>
              <p className="text-sm font-medium leading-relaxed opacity-80">
                {feat.desc}
              </p>
            </div>
          ))}
        </div>

        <div className="p-8 md:p-16 border-b-4 lg:border-b-0 border-swiss-black bg-swiss-muted swiss-grid-pattern flex flex-col justify-center order-1 lg:order-2">
          <h2 className="text-[5rem] md:text-[6rem] leading-[0.8] font-black tracking-tighter uppercase mb-6 flex flex-col">
            <span className="text-swiss-accent text-3xl md:text-4xl tracking-widest mb-4">01.</span>
            Features
          </h2>
          <p className="text-xl font-medium max-w-md">
            The building blocks of true automation. Powerful APIs, built-in security, and uncompromised precision.
          </p>
        </div>
      </section>

      {/* Section 02: Use Cases */}
      <section id="use-cases" className="grid grid-cols-1 lg:grid-cols-[5fr_7fr] border-b-4 border-swiss-black">
        <div className="p-8 md:p-16 border-b-4 lg:border-b-0 lg:border-r-4 border-swiss-black bg-swiss-white lg:sticky top-20 h-fit">
          <h2 className="text-[5rem] md:text-[6rem] leading-[0.8] font-black tracking-tighter uppercase mb-6 flex flex-col">
            <span className="text-swiss-accent text-3xl md:text-4xl tracking-widest mb-4">02.</span>
            Use <br />Cases
          </h2>
          <p className="text-xl font-medium max-w-md">
            Transform browser automation into a seamless, intelligent process. Designed for resilience, visibility, and speed.
          </p>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 bg-swiss-muted">
          {[
            {
              icon: Terminal,
              title: "Autonomous Web Agents",
              desc: "Deploy local AI agents to navigate the web, fill forms, and interact with complex dynamic web apps natively through our specialized agent loop."
            },
            {
              icon: Box,
              title: "Visual Web Extraction",
              desc: "Scrape and extract data from dynamic sites using real browsers powered by Playwright and intelligent AI extraction tools."
            },
            {
              icon: Globe,
              title: "Automated E2E Testing",
              desc: "Run robust visual tests on localhost or production using the persistent Playwright context and WebRTC streaming for visual debugging."
            },
            {
              icon: MousePointerClick,
              title: "Human Checkpoints",
              desc: "Execute multi-step browser workflows with human-in-the-loop checkpoints and interactive takeovers. Pause, inspect, and assume control instantly."
            }
          ].map((feature, i) => (
            <div key={i} className="group p-8 md:p-12 border-b-4 border-swiss-black sm:even:border-l-4 sm:even:-ml-[4px] sm:[&:nth-last-child(-n+2)]:border-b-0 bg-swiss-white hover:bg-swiss-accent hover:text-swiss-white transition-colors duration-150 cursor-crosshair flex flex-col h-full">
              <div className="flex justify-between items-start mb-12">
                <div className="w-16 h-16 border-4 border-swiss-black flex items-center justify-center bg-swiss-white text-swiss-black group-hover:scale-110 transition-transform duration-150">
                  <feature.icon className="w-8 h-8 stroke-[3]" />
                </div>
                <Plus className="w-8 h-8 text-swiss-black group-hover:text-swiss-white group-hover:rotate-90 transition-transform duration-150" />
              </div>
              <div className="mt-auto">
                <h3 className="text-2xl font-black uppercase tracking-tight mb-4">{feature.title}</h3>
                <p className="text-base font-medium leading-relaxed group-hover:text-swiss-white/90">
                  {feature.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>
      
      {/* Playful Break Section */}
      <section className="h-[40vh] min-h-[400px] bg-swiss-black swiss-diagonal border-b-4 border-swiss-black flex items-center justify-center relative overflow-hidden group">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-[120%] h-[120%] bg-swiss-accent rounded-full translate-y-[100%] group-hover:translate-y-0 transition-transform duration-700 ease-in-out" />
        </div>
        <h2 className="relative z-10 text-3xl md:text-6xl lg:text-7xl font-black text-swiss-white uppercase tracking-tighter text-center group-hover:scale-105 transition-transform duration-500 mix-blend-difference px-4">
          Stop coding scrapers.<br />Start writing prompts.
        </h2>
      </section>

    </main>
  );
}
