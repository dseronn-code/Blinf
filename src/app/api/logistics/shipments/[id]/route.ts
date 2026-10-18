import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { advanceTracking, buyShipmentLabel, cancelShipment, markManualShipment } from '@/server/services/logistics';
import { setShipmentVolumes } from '@/server/services/operations';

export const POST = route('logistica', 'edit', async ({ ctx, params, body }) => {
  // advance: rastreio real no provedor (frete próprio: próxima etapa manual; demonstração: avanço simulado) | buy: compra a etiqueta pendente
  if (body.action === 'advance') return advanceTracking(ctx, params.id);
  // mark: frete próprio/retirada — { status: 'POSTADO' | 'ENTREGUE', trackingCode } informados pelo usuário
  if (body.action === 'mark') return markManualShipment(ctx, params.id, { status: body.status || undefined, trackingCode: body.trackingCode });
  if (body.action === 'buy') return buyShipmentLabel(ctx, params.id);
  if (body.action === 'volumes') return setShipmentVolumes(ctx, params.id, Number(body.volumes), body.weight ? Number(body.weight) : undefined);
  if (body.action === 'cancel') return cancelShipment(ctx, params.id);
  fail(400, 'Ação inválida');
});
