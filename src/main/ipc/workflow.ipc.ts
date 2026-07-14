/**
 * @file workflow.ipc.ts
 * @description Main process IPC registration module managing the CRUD operations for local workflows.
 * Exposes IPC invocation channels to the renderer process to list, save, and delete workflows.
 * Internal mechanics involve parsing and validating incoming workflow objects using Zod schema verification
 * before interacting with the local JSON/sqlite storage repository.
 * Interacts directly with database/storage modules and maps schema definitions from the shared module.
 */

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
