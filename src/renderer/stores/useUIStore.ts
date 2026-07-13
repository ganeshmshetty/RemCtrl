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
  setRightPanelTab: (tab: RightPanelTab) => void;
  openWorkflowEditor: (workflowId?: string) => void;
  /** Open the editor pre-filled with a workflow object (unsaved, from AI run or ext recording) */
  openWorkflowEditorWithData: (data: Partial<LocalWorkflow>) => void;
  closeWorkflowEditor: () => void;
  openSettings: () => void;
  closeSettings: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  rightPanelTab: 'agent',
  isWorkflowEditorOpen: false,
  editingWorkflowId: null,
  prefillWorkflow: null,
  isSettingsOpen: false,

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
}));
