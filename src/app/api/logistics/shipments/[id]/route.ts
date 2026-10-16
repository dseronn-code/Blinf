import { route } from '@/server/http';
import { fail } from '@/server/errors';
import { advanceTracking, buyShipmentLabel, cancelShipment } from '@/server/services/logistics';
import { setShipmentVolumes } from '@/server/services/operations';

export const POST = route('logistica', 'edit', async ({ ctx, params, body }) => {
  // advance: rastreio real no provedor (ou avanço simulado) | buy: compra a etiqueta pendente
  if (body.action === 'advance') return advanceTracking(ctx, params.id);
  if (body.action === 'buy') return buyShipmentLabel(ctx, params.id);
  if (body.action === 'volumes') return setShipmentVolumes(ctx, params.id, Number(body.volumes), body.weight ? Number(body.weight) : undefined);
  if (body.action === 'cancel') return cancelShipment(ctx, params.id);
  fail(400, 'Ação inválida');
});
