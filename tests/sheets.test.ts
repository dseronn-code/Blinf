import { describe, it, expect } from 'vitest';
import { parseSheet, parseCsv, toXlsx } from '@/server/sheets';

describe('planilhas (importação/exportação)', () => {
  it('CSV com ; aspas e acentos nos cabeçalhos', async () => {
    const csv = '﻿Código;Descrição;Preço\r\nCAM-01;"Camiseta ""Básica""; algodão";59,90\r\n;;\r\nBON-01;Boné;79,90\r\n';
    const rows = await parseSheet(Buffer.from(csv), 'produtos.csv');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ codigo: 'CAM-01', descricao: 'Camiseta "Básica"; algodão', preco: '59,90' });
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('XLSX gerado é lido de volta', async () => {
    const buf = await toXlsx('Relatório de vendas', [{ key: 'sku', label: 'SKU' }, { key: 'name', label: 'Produto' }, { key: 'total', label: 'Total' }] as never, [{ sku: 'A1', name: 'Camiseta', total: 59.9 }, { sku: 'B2', name: 'Boné', total: 79.9 }]);
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    const rows = await parseSheet(buf, 'r.xlsx');
    expect(rows).toEqual([{ sku: 'A1', produto: 'Camiseta', total: '59.9' }, { sku: 'B2', produto: 'Boné', total: '79.9' }]);
  });
});
