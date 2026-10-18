import { gzipSync } from 'zlib';
import { route, fileResponse } from '@/server/http';
import { fail } from '@/server/errors';
import { exportAll } from '@/server/services/setup';

/** Backup completo (JSON compactado) — só administrador. Contém dados sensíveis: guarde em local seguro. */
export const GET = route('configuracoes', 'view', async ({ ctx }) => {
  if (!ctx.isAdmin) fail(403, 'Somente administradores');
  const data = await exportAll();
  const json = JSON.stringify(data, (_k, v) => (v && typeof v === 'object' && v.type === 'Buffer' && Array.isArray(v.data) ? { $bytes: Buffer.from(v.data).toString('base64') } : typeof v === 'bigint' ? v.toString() : v));
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return fileResponse(gzipSync(json), 'application/gzip', `gestaopro-backup-${stamp}.json.gz`, false);
});
