'use client';
import { createContext, useContext } from 'react';
import { can, type AccessLevel, type ModuleKey, type Permissions } from '@/lib/permissions';

export type Me = {
  user: { id: string; name: string; email: string; role: string; isAdmin: boolean };
  permissions: Permissions;
  companyId: string;
  companies: { id: string; name: string; tradeName: string | null; cnpj: string; logoColor: string; uf: string; taxRegime: string }[];
  consolidated: boolean;
  stockMode: string;
  unread: number;
};

export const MeContext = createContext<Me | null>(null);
export function useMe() {
  return useContext(MeContext)!;
}
export function useCan() {
  const me = useMe();
  return (mod: ModuleKey, level: AccessLevel = 'view') => can(me?.permissions, me?.user.isAdmin, mod, level);
}
