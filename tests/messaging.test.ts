import crypto from 'crypto';
import { describe, it, expect } from 'vitest';
import { renderWith, fillTemplate, DEFAULT_TEMPLATES, htmlToText } from '@/server/services/emailTemplates';
import { toE164, waTemplatePayload, buildWaMessage, verifyHubSignature, verifyChallenge } from '@/server/integrations/providers/whatsapp';
import { webhookToken } from '@/server/integrations/accounts';

const brand = { name: 'Loja <Exemplo>', color: '#ff0066', email: 'contato@loja.com' };

describe('modelos de e-mail', () => {
  it('escapa as variáveis no HTML e mantém o assunto em texto', () => {
    const r = renderWith(DEFAULT_TEMPLATES.rastreio, { cliente: '<script>alert("x")</script>', pedido: '1024', transportadora: 'Correios (SEDEX)', rastreio: 'QB123456785BR', link: 'https://x.com/?a=1&b="2"' }, brand);
    expect(r.subject).toBe('Seu pedido 1024 foi enviado');
    expect(r.html).not.toContain('<script>');
    expect(r.html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(r.html).toContain('href="https://x.com/?a=1&amp;b=&quot;2&quot;"');
    expect(r.html).toContain('Loja &lt;Exemplo&gt;');
    expect(r.html).toContain('#ff0066');
    expect(r.text).toContain('<script>alert("x")</script>');
    expect(r.text).toContain('QB123456785BR');
  });

  it('seções condicionais e quebras de linha', () => {
    expect(fillTemplate('a{{#pix}} PIX:{{pix}}{{/pix}}b', { pix: '' })).toBe('ab');
    expect(fillTemplate('a{{#pix}} PIX:{{pix}}{{/pix}}b', { pix: '00020' })).toBe('a PIX:00020b');
    expect(fillTemplate('{{itens}}', { itens: '1x A\n2x <B>' })).toBe('1x A<br>2x &lt;B&gt;');
    const r = renderWith(DEFAULT_TEMPLATES.cobranca, { cliente: 'Ana', documento: 'Venda 10', valor: 'R$ 10,00', vencimento: '01/10/2026', linha_digitavel: '3419...' }, brand);
    expect(r.html).toContain('Linha digitável');
    expect(r.html).not.toContain('Pix copia e cola');
    expect(r.subject).toBe('Pagamento em aberto — Loja <Exemplo>');
  });

  it('texto puro a partir do HTML', () => {
    expect(htmlToText('<p>Olá &amp; bem-vindo</p><p><a href="https://a.b">Clique</a></p>')).toBe('Olá & bem-vindo\n\nClique: https://a.b');
  });
});

describe('WhatsApp Cloud API', () => {
  it('telefone em E.164', () => {
    expect(toE164('(11) 98765-4321')).toBe('5511987654321');
    expect(toE164('+55 21 3333-4444')).toBe('552133334444');
    expect(toE164('12345')).toBeNull();
  });

  it('payload de mensagem de modelo (template) com parâmetros do corpo', () => {
    expect(waTemplatePayload('5511987654321', 'rastreio_pedido', 'pt_BR', ['Maria', '1024', 'Correios (SEDEX)', 'QB123456785BR'])).toEqual({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: '5511987654321', type: 'template',
      template: { name: 'rastreio_pedido', language: { code: 'pt_BR' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Maria' }, { type: 'text', text: '1024' }, { type: 'text', text: 'Correios (SEDEX)' }, { type: 'text', text: 'QB123456785BR' }] }] },
    });
  });

  it('usa o modelo do evento; texto livre só dentro da janela de 24 h', () => {
    const acc = { settings: { templateRastreio: 'rastreio_pedido', lastInbound: { '5511987654321': Date.now() - 3600_000 } } };
    expect((buildWaMessage(acc, '5511900000000', 'oi', { event: 'rastreio', params: ['a'] }) as any).template.name).toBe('rastreio_pedido');
    expect((buildWaMessage(acc, '5511987654321', 'oi', null) as any).text.body).toBe('oi');
    expect(() => buildWaMessage(acc, '5511900000000', 'oi', { event: 'os' })).toThrow(/janela de 24 h/);
  });

  it('verifica X-Hub-Signature-256 com o app secret', () => {
    const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    const sig = `sha256=${crypto.createHmac('sha256', 'app-secret').update(raw).digest('hex')}`;
    expect(verifyHubSignature('app-secret', raw, sig)).toBe(true);
    expect(verifyHubSignature('outro', raw, sig)).toBe(false);
    expect(verifyHubSignature('app-secret', raw + ' ', sig)).toBe(false);
    expect(verifyHubSignature('app-secret', raw, null)).toBe(false);
  });

  it('verificação do webhook (hub.challenge)', () => {
    const acc = { id: 'conta1', settings: { verifyToken: 'meu-token' } };
    expect(verifyChallenge(new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'meu-token', 'hub.challenge': '12345' }), acc)).toBe('12345');
    expect(verifyChallenge(new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': webhookToken('conta1'), 'hub.challenge': '9' }), acc)).toBe('9');
    expect(verifyChallenge(new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'errado', 'hub.challenge': '1' }), acc)).toBeNull();
  });
});
