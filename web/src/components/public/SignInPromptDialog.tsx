import { useEffect } from "react";
import { SignInPanel } from "@/components/account/SignInPanel";
import { useAccountUser } from "@/lib/useAccount";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Shown when a signed-out cook presses Like / Save / Make a copy. Closes itself on sign-in. */
export function SignInPromptDialog({
  open,
  onOpenChange,
  action,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: string;
}) {
  const user = useAccountUser();
  useEffect(() => {
    if (open && user) onOpenChange(false);
  }, [open, user, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign in to {action}</DialogTitle>
          <DialogDescription>
            A free account keeps your saved recipes and copies on every device. You'll come back to this recipe.
          </DialogDescription>
        </DialogHeader>
        <SignInPanel />
      </DialogContent>
    </Dialog>
  );
}
