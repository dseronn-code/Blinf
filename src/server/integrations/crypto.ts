/**
 * Criptografia dos segredos de integração (tokens, chaves de API, senhas).
 * AES-256-GCM com chave derivada de ENCRYPTION_KEY (ou NEXTAUTH_SECRET).
 */
import crypto from 'crypto';

function key() {
  const base = process.env.ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET || 'gestaopro-dev-secret';
  return crypto.createHash('sha256').update(`gestaopro:integrations:${base}`).digest();
}

export function encrypt(plain: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

export function decrypt(payload: string) {
  const [v, iv, tag, data] = payload.split(':');
  if (v !== 'v1') throw new Error('Formato de segredo desconhecido');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}

export const encryptJson = (o: object) => encrypt(JSON.stringify(o));
export const decryptJson = <T = Record<string, string>>(s: string | null | undefined): T => (s ? JSON.parse(decrypt(s)) : {}) as T;

/** Mascara um segredo para exibição (ex.: "sk_live_…9f3a") */
export const mask = (v: string | undefined | null) => (!v ? '' : v.length <= 8 ? '••••' : `${v.slice(0, 4)}…${v.slice(-4)}`);
