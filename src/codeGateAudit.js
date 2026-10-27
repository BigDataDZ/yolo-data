import { incrementCounter } from './metrics.js';
import { callPlatformDatabase } from './platformDatabaseAccess.js';

export async function recordCodeGateBlock(database, { userId, sessionId, error }) {
  incrementCounter('gate_block_total', {
    gateId: 'CODE-001', phase: 'EXECUTE', blocking: 'true',
  });
  const entry = {
    userId,
    action: 'CODE_GATE_BLOCK',
    detail: {
      sessionId: sessionId ?? null,
      code: error.code ?? 'CODE_DATASOURCE_ACCESS_FORBIDDEN',
      message: error.message,
    },
  };
  if (database?.isAsyncPlatformStore || typeof database?.addAuditLogAsync === 'function') {
    return await callPlatformDatabase(database, 'addAuditLogAsync', 'addAuditLog', entry);
  }
  return database?.addAuditLog?.(entry);
}
