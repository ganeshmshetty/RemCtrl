import { useEffect, useRef, useState } from 'react';
import { BrowserPanel } from './BrowserPanel';
import { RightPanelLayout } from './RightPanelLayout';
import { useUIStore } from '../stores/useUIStore';

export function LocalSession() {
  const [rightPanelWidth, setRightPanelWidth] = useState(384);
  const isResizing = useRef(false);
  const { isSidebarOpen } = useUIStore();

  function handleResizeKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    setRightPanelWidth((width) => Math.min(800, Math.max(300, width + (event.key === 'ArrowLeft' ? 16 : -16))));
  }

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

      {isSidebarOpen && (
        <>
          <div 
            className="drag-handle-vertical"
            role="separator"
            tabIndex={0}
            aria-label="Resize workspace sidebar"
            aria-orientation="vertical"
            aria-valuemin={300}
            aria-valuemax={800}
            aria-valuenow={rightPanelWidth}
            onKeyDown={handleResizeKeyDown}
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
