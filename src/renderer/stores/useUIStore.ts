/**
 * @file useUIStore.ts
 * @description Zustand store managing renderer UI routing, modal visibility, and layout panel states.
 * Exports the `useUIStore` hook and `RightPanelTab` type to control right panel tabs, settings overlay,
 * and workflow editor state (including pre-filling workflows from recorded agent loops).
 * Plays a key role in navigation and data handoffs, such as opening the workflow creator
 * with steps captured by the execution engine and saved in `useAgentStore`.
 */

import { create } from 'zustand';
import type { LocalWorkflow } from '../../shared/types';

export type RightPanelTab = 'agent' | 'workflows';

interface UIState {
  rightPanelTab: RightPanelTab;
  isWorkflowEditorOpen: boolean;
  editingWorkflowId: string | null;
  /** Pre-filled workflow data when opening from AI-recorded run or Chrome extension */
  prefillWorkflow: Partial<LocalWorkflow> | null;
  isSettingsOpen: boolean;
  isSidebarOpen: boolean;
  setRightPanelTab: (tab: RightPanelTab) => void;
  openWorkflowEditor: (workflowId?: string) => void;
  /** Open the editor pre-filled with a workflow object (unsaved, from AI run or ext recording) */
  openWorkflowEditorWithData: (data: Partial<LocalWorkflow>) => void;
  closeWorkflowEditor: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  toggleSidebar: () => void;
  setSidebarOpen: (isOpen: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  rightPanelTab: 'agent',
  isWorkflowEditorOpen: false,
  editingWorkflowId: null,
  prefillWorkflow: null,
  isSettingsOpen: false,
  isSidebarOpen: true,

  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
  
  openWorkflowEditor: (workflowId) => set({ 
    isWorkflowEditorOpen: true, 
    editingWorkflowId: workflowId ?? null,
    prefillWorkflow: null,
  }),

  openWorkflowEditorWithData: (data) => set({
    isWorkflowEditorOpen: true,
    editingWorkflowId: null,
    prefillWorkflow: data,
  }),
  
  closeWorkflowEditor: () => set({ 
    isWorkflowEditorOpen: false, 
    editingWorkflowId: null,
    prefillWorkflow: null,
  }),

  openSettings: () => set({ isSettingsOpen: true }),
  closeSettings: () => set({ isSettingsOpen: false }),
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  setSidebarOpen: (isOpen) => set({ isSidebarOpen: isOpen }),
}));
