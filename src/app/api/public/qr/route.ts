import bwipjs from 'bwip-js/node';

// Gera QR Code (PNG) localmente — usado para Pix e NFC-e na interface
export async function GET(req: Request) {
  const data = new URL(req.url).searchParams.get('data') || '';
  const png = await bwipjs.toBuffer({ bcid: 'qrcode', text: data.slice(0, 1500) || ' ', scale: 4 } as never);
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' } });
}
