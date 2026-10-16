'use client';
import * as DM from '@radix-ui/react-dropdown-menu';
import { cn } from '@/lib/utils';

export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;
export function DropdownMenuContent({ className, align = 'end', ...p }: DM.DropdownMenuContentProps) {
  return (
    <DM.Portal>
      <DM.Content align={align} sideOffset={4} className={cn('z-50 min-w-[190px] rounded-md border bg-popover p-1 shadow-lg', className)} {...p} />
    </DM.Portal>
  );
}
export function DropdownMenuItem({ className, ...p }: DM.DropdownMenuItemProps) {
  return <DM.Item className={cn('flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-50 [&_svg]:size-4', className)} {...p} />;
}
export const DropdownMenuSeparator = () => <DM.Separator className="my-1 h-px bg-border" />;
export function DropdownMenuLabel({ children }: { children: React.ReactNode }) {
  return <DM.Label className="px-2 py-1 text-xs font-semibold text-muted-foreground">{children}</DM.Label>;
}
