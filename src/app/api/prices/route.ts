import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { resolvePrice } from '@/server/services/sales';

// Preço de um produto considerando lista de preço e quantidade
export const GET = route(null, 'view', async ({ query }) => ({ price: await resolvePrice(prisma, query.get('productId')!, query.get('priceListId'), Number(query.get('qty')) || 1) }));
