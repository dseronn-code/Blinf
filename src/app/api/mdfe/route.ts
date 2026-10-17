import { prisma } from '@/lib/db';
import { route } from '@/server/http';
import { createMdfe } from '@/server/services/mdfe';

/** MDF-e: lista e criação a partir de NF-e autorizadas */
export const GET = route('fiscal', 'view', async ({ ctx, query }) => {
  const where: any = { companyId: ctx.companyId };
  if (query.get('status')) where.status = query.get('status');
  return prisma.mdfe.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300, omit: { xml: true } });
});

export const POST = route('fiscal', 'edit', async ({ ctx, body }) =>
  createMdfe(ctx, {
    invoiceIds: Array.isArray(body?.invoiceIds) ? body.invoiceIds : [], invoiceKeys: Array.isArray(body?.invoiceKeys) ? body.invoiceKeys : [],
    vehiclePlate: body?.vehiclePlate || '', vehicleTara: Number(body?.vehicleTara) || 0, vehicleUf: body?.vehicleUf || '', rntrc: body?.rntrc || null,
    driverName: body?.driverName || '', driverCpf: body?.driverCpf || '', route: Array.isArray(body?.route) ? body.route : [],
    ufStart: body?.ufStart || undefined, ufEnd: body?.ufEnd || undefined, loadCity: body?.loadCity || undefined, loadCityCode: body?.loadCityCode || undefined,
    unloadCity: body?.unloadCity || undefined, unloadCityCode: body?.unloadCityCode || undefined,
    loads: Array.isArray(body?.loads) ? body.loads : undefined, unloads: Array.isArray(body?.unloads) ? body.unloads : undefined,
    tpRod: body?.tpRod || undefined, tpCar: body?.tpCar || undefined, capKG: Number(body?.capKG) || null, capM3: Number(body?.capM3) || null,
    trailers: Array.isArray(body?.trailers) ? body.trailers : [],
  }),
);
