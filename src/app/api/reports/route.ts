import { route } from '@/server/http';
import { REPORTS } from '@/server/services/reports';

export const GET = route('relatorios', 'view', async () => ({ rows: Object.entries(REPORTS).map(([key, r]) => ({ key, title: r.title, group: r.group, description: r.description })) }));
