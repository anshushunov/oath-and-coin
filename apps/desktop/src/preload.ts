import { contextBridge, ipcRenderer } from 'electron';

import { DESCRIBE_HOST_CHANNEL, describeHostResponse, type HostDescription } from './contract';

/**
 * The only surface the renderer sees (ADR-010: "preload — узкий типизированный
 * API через `contextBridge`").
 *
 * The response is validated here as well as produced under a schema in the
 * main process. That is not belt and braces for its own sake: the renderer
 * cannot tell a malformed reply from a valid one, and a bridge that forwards
 * whatever arrives is the place where `undefined` starts propagating into the
 * UI with no stack pointing back here.
 */
const desktopApi = {
  async describeHost(): Promise<HostDescription> {
    const reply: unknown = await ipcRenderer.invoke(DESCRIBE_HOST_CHANNEL);
    return describeHostResponse.parse(reply);
  }
} as const;

contextBridge.exposeInMainWorld('desktop', desktopApi);

export type DesktopApi = typeof desktopApi;
