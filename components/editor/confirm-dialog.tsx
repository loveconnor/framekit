"use client";

import { useEditor } from "@/store/editor-store";
import {
  AlertDialog, AlertDialogPopup, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogClose,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function ConfirmDialog() {
  const confirm = useEditor((s) => s.confirm);
  const setConfirm = useEditor((s) => s.setConfirm);
  return (
    <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
      <AlertDialogPopup className="max-w-[400px]">
        <AlertDialogHeader>
          <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirm?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
          <Button
            onClick={() => {
              const action = confirm?.onConfirm;
              setConfirm(null);
              action?.();
            }}
          >
            {confirm?.action}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
