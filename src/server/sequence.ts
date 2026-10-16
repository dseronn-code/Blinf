import type { Db } from '@/lib/db';

/** Próximo número sequencial por empresa (pedido, NF-e, OS...) — atômico via upsert/increment */
export async function nextNumber(db: Db, companyId: string, key: string, start = 1): Promise<number> {
  const seq = await db.sequence.upsert({
    where: { companyId_key: { companyId, key } },
    create: { companyId, key, value: start },
    update: { value: { increment: 1 } },
  });
  return seq.value;
}
