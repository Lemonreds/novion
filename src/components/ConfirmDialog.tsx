import { useUi } from "@/store/ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";

export function ConfirmDialog() {
  const confirm = useUi((s) => s.confirm);
  const close = useUi((s) => s.closeConfirm);

  return (
    <Dialog open={confirm.open} onOpenChange={(open) => (!open ? close() : undefined)}>
      <DialogContent>
        <DialogTitle>{confirm.title}</DialogTitle>
        {confirm.description ? <DialogDescription>{confirm.description}</DialogDescription> : null}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={close}>
            取消
          </Button>
          <Button
            size="sm"
            autoFocus
            variant={confirm.destructive ? "destructive" : "default"}
            onClick={() => {
              confirm.onConfirm?.();
              close();
            }}
          >
            {confirm.confirmLabel ?? "确认"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}