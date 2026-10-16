import { withAuth } from 'next-auth/middleware';

// Protege todas as rotas do ERP; loja virtual, pagamento, API pública e login são livres
export default withAuth({ pages: { signIn: '/login' }, secret: process.env.NEXTAUTH_SECRET || 'gestaopro-dev-secret' });

export const config = {
  matcher: ['/((?!api|login|loja|pagar|_next/static|_next/image|favicon.ico).*)'],
};
