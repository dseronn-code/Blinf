import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { fail } from '@/server/errors';

const MAX = 4 * 1024 * 1024;
const ALLOWED = /^(image\/(png|jpe?g|webp|gif)|application\/pdf|text\/(plain|csv|xml)|application\/xml)$/;

/** Upload de arquivos (imagens de produtos, anexos). multipart/form-data campo "file" */
export const POST = route(null, 'view', async ({ ctx, req }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') fail(400, 'Envie o arquivo no campo "file"');
  const f = file as File;
  if (f.size > MAX) fail(400, 'Arquivo maior que 4 MB');
  if (!ALLOWED.test(f.type)) fail(400, `Tipo de arquivo não permitido (${f.type || 'desconhecido'})`);
  const row = await prisma.upload.create({ data: { organizationId: ctx.orgId, filename: f.name.slice(0, 200), mime: f.type, size: f.size, data: Buffer.from(await f.arrayBuffer()) } });
  return { id: row.id, url: `/api/files/${row.id}`, filename: row.filename, size: row.size };
});
