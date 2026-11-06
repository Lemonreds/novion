import * as React from "react";
import * as ContextPrimitive from "@radix-ui/react-context-menu";
import { cn } from "@/lib/utils";

/**
 * Radix menus default to `modal`, which on open
 * - mounts `RemoveScroll` (writes `overflow` / padding compensation onto body)
 * - stamps `aria-hidden` on every other node in the document
 * and on close undoes all of it. With an editor plus a virtualised tree on
 * screen that is a full style/layout recalculation per right-click — the menu
 * visibly stutters before it paints. These menus never need focus trapping, so
 * `modal={false}` is both cheaper and closer to a native context menu.
 */
export function ContextMenu({
  modal = false,
  ...props
}: React.ComponentPropsWithoutRef<typeof ContextPrimitive.Root>) {
  return <ContextPrimitive.Root modal={modal} {...props} />;
}

export const ContextMenuTrigger = ContextPrimitive.Trigger;

export const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextPrimitive.Content>
>(({ className, ...props }, ref) => (
  <ContextPrimitive.Portal>
    <ContextPrimitive.Content
      ref={ref}
      className={cn(
        "anim-menu z-50 min-w-44 overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-[0_10px_30px_-10px_rgba(0,0,0,0.35)]",
        className,
      )}
      {...props}
    />
  </ContextPrimitive.Portal>
));
ContextMenuContent.displayName = "ContextMenuContent";

export const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextPrimitive.Item> & { destructive?: boolean }
>(({ className, destructive, ...props }, ref) => (
  <ContextPrimitive.Item
    ref={ref}
    className={cn(
      "flex h-7 cursor-default select-none items-center gap-2 rounded-md px-2 text-[13px] outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-45 [&_svg]:size-3.5 [&_svg]:opacity-70",
      destructive && "text-destructive data-[highlighted]:text-destructive",
      className,
    )}
    {...props}
  />
));
ContextMenuItem.displayName = "ContextMenuItem";

export function ContextMenuSeparator({ className }: { className?: string }) {
  return <ContextPrimitive.Separator className={cn("my-1 h-px bg-border", className)} />;
}