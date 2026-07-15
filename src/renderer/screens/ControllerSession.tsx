/**
 * @file ControllerSession.tsx
 * @description Layout orchestrator for the remote Controller Session dashboard views.
 * Combines the remote browser view (BrowserPanel) with the right side control panel (RightPanelLayout) in a split pane.
 * Offers a draggable vertical divider (drag-handle-vertical) utilizing window-level pointer event listeners
 * to dynamically resize the right sidebar width, storing the width state locally.
 * Key exports: ControllerSession (function component).
 */

import { useEffect, useRef, useState } from 'react';
import { useConnectionStore } from '../stores/useConnectionStore';
import { useUIStore } from '../stores/useUIStore';
import { BrowserPanel } from './BrowserPanel';
import { RightPanelLayout } from './RightPanelLayout';
import './ControllerSession.css';

export function ControllerSession() {
  const { role } = useConnectionStore();
  const [rightPanelWidth, setRightPanelWidth] = useState(384);
  const isResizing = useRef(false);
  const { isSidebarOpen } = useUIStore();

  useEffect(() => {
    if (role === 'idle') return;
    function handlePointerMove(e: PointerEvent) {
      if (!isResizing.current) return;
      const newWidth = document.body.clientWidth - e.clientX;
      if (newWidth > 300 && newWidth < 800) {
        setRightPanelWidth(newWidth);
      }
    }
    function handlePointerUp() {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = '';
      }
    }
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      isResizing.current = false;
      document.body.style.cursor = '';
    };
  }, [role]);

  return (
    <>
      <BrowserPanel />

      {role !== 'idle' && isSidebarOpen && (
        <>
          <div 
            className="drag-handle-vertical"
            onPointerDown={(e) => {
              isResizing.current = true;
              document.body.style.cursor = 'col-resize';
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerUp={(e) => {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }}
          />

          <div className="workspace-sidepanel" style={{ width: rightPanelWidth }}>
            <RightPanelLayout />
          </div>
        </>
      )}
    </>
  );
}
