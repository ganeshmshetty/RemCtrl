import { ipcMain } from 'electron';
import { LocalWorkflowSchema } from '../../shared/schemas.js';
import {
  listWorkflows,
  saveWorkflow,
  deleteWorkflow,
} from '../storage.js';

export function registerWorkflowIpc() {
  ipcMain.handle('workflows:list', async () => listWorkflows());

  ipcMain.handle('workflows:save', async (_e, workflow: unknown) => {
    saveWorkflow(LocalWorkflowSchema.parse(workflow));
  });

  ipcMain.handle('workflows:delete', async (_e, workflowId: unknown) => {
    if (typeof workflowId !== 'string' || !workflowId) throw new Error('Invalid workflowId');
    deleteWorkflow(workflowId);
  });
}
