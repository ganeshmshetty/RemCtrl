import { useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Bot, Command as CommandIcon, MonitorPlay, PanelRight, Search, Settings2, Zap } from 'lucide-react';
import { useConnectionStore } from '../stores/useConnectionStore';
import { useAgentStore } from '../stores/useAgentStore';
import { useUIStore } from '../stores/useUIStore';
import './CommandPalette.css';

type PaletteCommand = {
  id: string;
  label: string;
  description: string;
  group: string;
  shortcut?: string;
  icon: LucideIcon;
  keywords: string[];
  run: () => void;
};

export function CommandPalette() {
  const role = useConnectionStore((state) => state.role);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const openPalette = () => setOpen(true);
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
      if (!open) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
    };

    window.addEventListener('remotectrl:open-command-palette', openPalette);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('remotectrl:open-command-palette', openPalette);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const commands = useMemo<PaletteCommand[]>(() => [
    {
      id: 'new-session',
      label: 'New agent session',
      description: 'Clear the current task thread and start fresh',
      group: 'Session',
      shortcut: 'N',
      icon: Bot,
      keywords: ['new', 'chat', 'agent', 'session', 'task'],
      run: () => {
        useAgentStore.getState().startNewChat();
        useUIStore.getState().setRightPanelTab('agent');
        useUIStore.getState().setSidebarOpen(true);
      },
    },
    ...(role === 'idle' ? [{
      id: 'start-local',
      label: 'Start local session',
      description: 'Open a private browser session on this computer',
      group: 'Session',
      icon: MonitorPlay,
      keywords: ['local', 'browser', 'start', 'private'],
      run: () => {
        useConnectionStore.getState().setRole('local');
        void window.RemoteCtrlAPI?.browser.launch();
        void window.RemoteCtrlAPI?.app.showMiniWindow(true);
      },
    }] : []),
    {
      id: 'open-agent',
      label: 'Show agent',
      description: 'Open the agent conversation and task activity',
      group: 'Workspace',
      icon: Bot,
      keywords: ['agent', 'chat', 'activity'],
      run: () => {
        useUIStore.getState().setRightPanelTab('agent');
        useUIStore.getState().setSidebarOpen(true);
      },
    },
    {
      id: 'open-workflows',
      label: 'Show workflows',
      description: 'Browse, preview, and run reusable browser tasks',
      group: 'Workspace',
      icon: Zap,
      keywords: ['workflow', 'automation', 'run'],
      run: () => {
        useUIStore.getState().setRightPanelTab('workflows');
        useUIStore.getState().setSidebarOpen(true);
      },
    },
    {
      id: 'toggle-sidebar',
      label: 'Toggle workspace sidebar',
      description: 'Show or hide the agent and workflow controls',
      group: 'Workspace',
      shortcut: '⌘\\',
      icon: PanelRight,
      keywords: ['sidebar', 'panel', 'hide', 'show'],
      run: () => useUIStore.getState().toggleSidebar(),
    },
    {
      id: 'open-settings',
      label: 'Open settings',
      description: 'Configure providers, browser profiles, and connection defaults',
      group: 'Application',
      icon: Settings2,
      keywords: ['settings', 'preferences', 'provider', 'model'],
      run: () => useUIStore.getState().openSettings(),
    },
  ], [role]);

  const filteredCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return commands;
    return commands.filter((command) => [command.label, command.description, ...command.keywords].join(' ').toLowerCase().includes(normalized));
  }, [commands, query]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const safeActiveIndex = Math.min(activeIndex, Math.max(filteredCommands.length - 1, 0));

  function close() {
    setOpen(false);
    setQuery('');
  }

  function runActiveCommand() {
    const command = filteredCommands[safeActiveIndex];
    if (!command) return;
    close();
    command.run();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(Math.min(safeActiveIndex + 1, Math.max(filteredCommands.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(Math.max(safeActiveIndex - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      runActiveCommand();
    }
  }

  if (!open) return null;

  let currentGroup = '';
  return (
    <div className="command-palette-backdrop" onMouseDown={close}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(event) => event.stopPropagation()}>
        <div className="command-palette-search-row">
          <Search size={17} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search commands…"
            aria-label="Search commands"
            autoComplete="off"
          />
          <kbd>Esc</kbd>
        </div>
        <div className="command-palette-list" role="listbox" aria-label="Commands">
          {filteredCommands.length === 0 ? (
            <div className="command-palette-empty"><CommandIcon size={18} /><strong>No matching commands</strong><span>Try a different search term.</span></div>
          ) : filteredCommands.map((command, index) => {
            const showGroup = command.group !== currentGroup;
            currentGroup = command.group;
            const Icon = command.icon;
            return (
              <div key={command.id}>
                {showGroup && <div className="command-palette-group-label">{command.group}</div>}
                <button
                  className={`command-palette-item ${index === safeActiveIndex ? 'is-active' : ''}`}
                  role="option"
                  aria-selected={index === safeActiveIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => { close(); command.run(); }}
                >
                  <span className="command-palette-item-icon"><Icon size={15} /></span>
                  <span className="command-palette-item-copy"><strong>{command.label}</strong><small>{command.description}</small></span>
                  {command.shortcut && <kbd>{command.shortcut}</kbd>}
                </button>
              </div>
            );
          })}
        </div>
        <footer className="command-palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>↵</kbd> Run</span><span><kbd>⌘</kbd><kbd>K</kbd> Open anytime</span></footer>
      </section>
    </div>
  );
}
