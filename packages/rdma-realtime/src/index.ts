/**
 * @rdma/realtime — WebSocket bridge for the RDMA pipeline.
 */

export { RealtimeServer, type RealtimeServerOptions } from './server.js';
export type { Event, EventKind } from '@rdma/persistence';
export { RealtimeClient, type RealtimeClientOptions, type RealtimeEventHandler } from './client.js';
