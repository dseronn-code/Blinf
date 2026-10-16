import { route } from '@/server/http';
import { simulationTick } from '@/server/services/integrations';

// Simulador "tempo real": chamado periodicamente pela interface quando ativado
export const POST = route('integracoes', 'edit', async ({ ctx }) => {
  const orders = await simulationTick(ctx);
  return { created: orders.map((o) => ({ id: o.id, number: o.number, total: o.total })) };
});
