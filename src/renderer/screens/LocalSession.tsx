/**
 * @file LocalSession.tsx
 * @description Layout orchestrator for local/host browser sessions where the agent runs directly on the local machine.
 * Combines the direct browser canvas viewer (BrowserPanel) with the agent/workflow controller panel (RightPanelLayout).
 * Features a draggable vertical divider enabling users to adjust the right sidebar panel size interactively via pointer capture.
 * Differs from ControllerSession by assuming an active local session role unconditionally without verifying connection store states.
 * Key exports: LocalSession (function component).
 */

import { useEffect, useRef, useState } from 'react';
import { BrowserPanel } from './BrowserPanel';
import { RightPanelLayout } from './RightPanelLayout';

export function LocalSession() {
  const [rightPanelWidth, setRightPanelWidth] = useState(380);
  const isResizing = useRef(false);

  useEffect(() => {
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
    };
  }, []);

  return (
    <>
      <BrowserPanel />

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

      <div style={{ width: rightPanelWidth, height: '100%', flexShrink: 0 }}>
        <RightPanelLayout />
      </div>
    </>
  );
}

