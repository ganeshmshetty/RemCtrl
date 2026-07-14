import { Terminal, Code, Cpu, ShieldAlert } from "lucide-react";

export default function Docs() {
  return (
    <main className="flex flex-col w-full relative bg-swiss-muted min-h-screen">
      {/* Header */}
      <header className="p-8 md:p-16 border-b-4 border-swiss-black bg-swiss-white">
        <h1 className="text-5xl md:text-[6rem] leading-[0.8] font-black tracking-tighter uppercase mb-6 flex flex-col">
          <span className="text-swiss-accent text-3xl md:text-4xl tracking-widest mb-4">02.</span>
          Documentation
        </h1>
        <p className="text-xl md:text-2xl font-medium max-w-2xl">
          The architecture, the setup, and the engineering behind RemoteCtrl. Objective, structured, and precise.
        </p>
      </header>

      {/* Docs Grid */}
      <div className="grid grid-cols-1 md:grid-cols-[3fr_9fr] lg:grid-cols-[4fr_8fr] flex-1">
        
        {/* Sidebar Nav */}
        <aside className="border-b-4 md:border-b-0 md:border-r-4 border-swiss-black bg-swiss-white p-8 lg:p-12 hidden md:block">
          <nav className="sticky top-32 flex flex-col space-y-4 font-bold uppercase tracking-widest text-sm">
            <a href="#architecture" className="hover:text-swiss-accent flex items-center group">
              <span className="w-2 h-2 bg-swiss-black group-hover:bg-swiss-accent mr-4 transition-colors" />
              Architecture
            </a>
            <a href="#setup" className="hover:text-swiss-accent flex items-center group">
              <span className="w-2 h-2 bg-swiss-black group-hover:bg-swiss-accent mr-4 transition-colors" />
              Setup & Run
            </a>
            <a href="#ipc" className="hover:text-swiss-accent flex items-center group">
              <span className="w-2 h-2 bg-swiss-black group-hover:bg-swiss-accent mr-4 transition-colors" />
              IPC & Security
            </a>
            <a href="#storage" className="hover:text-swiss-accent flex items-center group">
              <span className="w-2 h-2 bg-swiss-black group-hover:bg-swiss-accent mr-4 transition-colors" />
              Storage
            </a>
          </nav>
        </aside>

        {/* Content */}
        <article className="p-8 lg:p-16 bg-swiss-white/80 swiss-grid-pattern space-y-24 min-w-0">
          
          <section id="architecture" className="scroll-mt-32">
            <div className="flex items-center mb-8 border-b-4 border-swiss-black pb-4">
              <Cpu className="w-8 h-8 mr-4 text-swiss-accent stroke-[3]" />
              <h2 className="text-3xl md:text-4xl font-black uppercase tracking-tighter">System Architecture</h2>
            </div>
            <p className="text-lg font-medium mb-8">
              RemoteCtrl runs on a dual-process architecture defined by Electron, separated cleanly by a secure preload bridge. 
              The application leverages React and TypeScript in the renderer, and Node.js for heavy automation tasks.
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="border-4 border-swiss-black p-8 bg-swiss-white hover:bg-swiss-black hover:text-swiss-white transition-colors group">
                <h3 className="text-xl font-bold uppercase tracking-widest mb-4 border-b-2 border-swiss-black pb-2 group-hover:border-swiss-white">Main Process</h3>
                <ul className="space-y-2 font-medium list-disc list-inside">
                  <li>AI Agent Execution Engine</li>
                  <li>Playwright Browser Wrappers</li>
                  <li>Visual Cursor Overlay Injector</li>
                  <li>Workflow Runner & Planner</li>
                  <li>WebRTC Signaling & Storage</li>
                </ul>
              </div>
              <div className="border-4 border-swiss-black p-8 bg-swiss-white hover:bg-swiss-accent hover:text-swiss-white transition-colors group">
                <h3 className="text-xl font-bold uppercase tracking-widest mb-4 border-b-2 border-swiss-black pb-2 group-hover:border-swiss-white">Renderer Process</h3>
                <ul className="space-y-2 font-medium list-disc list-inside">
                  <li>React UI Panels</li>
                  <li>Zustand State Stores</li>
                  <li>WebRTC Streaming Panel</li>
                  <li>Drag-and-Drop Editor</li>
                  <li>Floating Mini Controller</li>
                </ul>
              </div>
            </div>
          </section>

          <section id="setup" className="scroll-mt-32">
            <div className="flex items-center mb-8 border-b-4 border-swiss-black pb-4">
              <Terminal className="w-8 h-8 mr-4 text-swiss-accent stroke-[3]" />
              <h2 className="text-3xl md:text-4xl font-black uppercase tracking-tighter">Development Setup</h2>
            </div>
            
            <div className="border-4 border-swiss-black bg-swiss-black text-swiss-white p-8 font-mono text-sm sm:text-base overflow-x-auto relative group w-full">
              <div className="absolute top-0 right-0 bg-swiss-accent px-4 py-1 text-xs font-bold uppercase tracking-widest z-10">BASH</div>
              <pre className="whitespace-pre overflow-x-auto pt-4"><code>
<span className="text-swiss-white/50"># Install dependencies</span><br/>
npm install<br/><br/>
<span className="text-swiss-white/50"># Run renderer only (browser dev mode)</span><br/>
npm run dev:renderer<br/><br/>
<span className="text-swiss-white/50"># Build main process</span><br/>
npm run build:main<br/><br/>
<span className="text-swiss-white/50"># Run full Electron app</span><br/>
npm run dev
              </code></pre>
            </div>
          </section>

          <section id="ipc" className="scroll-mt-32">
            <div className="flex items-center mb-8 border-b-4 border-swiss-black pb-4">
              <ShieldAlert className="w-8 h-8 mr-4 text-swiss-accent stroke-[3]" />
              <h2 className="text-3xl md:text-4xl font-black uppercase tracking-tighter">Security & Constraints</h2>
            </div>
            <ul className="border-l-4 border-swiss-accent pl-8 space-y-6 text-lg font-medium">
              <li>
                <strong>No Node APIs in Renderer:</strong> The Renderer never accesses Node APIs directly. All communication happens exclusively through <code className="bg-swiss-black text-swiss-white px-2 py-1 text-sm border-2 border-swiss-black">window.RemoteCtrlAPI</code>.
              </li>
              <li>
                <strong>Zod Validation:</strong> All IPC payloads are strictly validated using Zod schemas in the main process before any logic is executed.
              </li>
              <li>
                <strong>Secure Key Storage:</strong> API keys are securely encrypted on disk using Electron's native <code className="bg-swiss-black text-swiss-white px-2 py-1 text-sm border-2 border-swiss-black">safeStorage</code> API.
              </li>
            </ul>
          </section>

        </article>
      </div>
    </main>
  );
}
