import { contextBridge, ipcRenderer } from 'electron';

import {
  DESCRIBE_HOST_CHANNEL,
  SAVE_LIST_CHANNEL,
  SAVE_READ_CHANNEL,
  SAVE_WRITE_CHANNEL,
  describeHostResponse,
  saveListResponse,
  saveReadResponse,
  saveWriteResponse,
  type DesktopSaveSlot,
  type HostDescription,
  type SaveReadReply
} from './contract';

/**
 * The only surface the renderer sees (ADR-010: "preload — узкий типизированный
 * API через `contextBridge`").
 *
 * Every reply is validated here as well as produced under a schema in the
 * main process. That is not belt and braces for its own sake: the renderer
 * cannot tell a malformed reply from a valid one, and a bridge that forwards
 * whatever arrives is the place where `undefined` starts propagating into the
 * UI with no stack pointing back here.
 */
const desktopApi = {
  async describeHost(): Promise<HostDescription> {
    const reply: unknown = await ipcRenderer.invoke(DESCRIBE_HOST_CHANNEL);
    return describeHostResponse.parse(reply);
  },

  async readSave(slot: DesktopSaveSlot): Promise<SaveReadReply> {
    const reply: unknown = await ipcRenderer.invoke(SAVE_READ_CHANNEL, slot);
    return saveReadResponse.parse(reply);
  },

  async writeSave(slot: DesktopSaveSlot, bytes: Uint8Array): Promise<void> {
    const reply: unknown = await ipcRenderer.invoke(SAVE_WRITE_CHANNEL, slot, bytes);
    saveWriteResponse.parse(reply);
  },

  async listSaves(): Promise<readonly DesktopSaveSlot[]> {
    const reply: unknown = await ipcRenderer.invoke(SAVE_LIST_CHANNEL);
    return saveListResponse.parse(reply);
  }
} as const;

contextBridge.exposeInMainWorld('desktop', desktopApi);

export type DesktopApi = typeof desktopApi;
