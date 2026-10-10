import { useState } from "react";
import { Check, Copy, MoreHorizontal, Pencil, ShoppingBasket, Trash2, X } from "lucide-react";
import type { ShoppingItem, ShoppingListDoc } from "@recipe/shared";
import { shoppingList } from "@/backend";
import { useShoppingList } from "@/lib/useShoppingList";
import {
  clearAll,
  clearChecked,
  editItem,
  formatAmount,
  groupForDisplay,
  listToText,
  removeItem,
  toggleItem,
} from "@/lib/shopping";
import { exploreHref, jobHref, publicHref } from "@/lib/router";
import { IS_CLOUD } from "@/lib/mode";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SignInPanel } from "@/components/account/SignInPanel";

const LABEL = "text-[12px] font-medium uppercase tracking-[0.08em] text-[hsl(var(--ink-muted))]";

function apply(fn: (list: ShoppingListDoc) => ShoppingListDoc, onError: (message: string) => void) {
  shoppingList.update(fn).catch((err: unknown) => onError(err instanceof Error ? err.message : "Something went wrong."));
}

function SourceChips({ item }: { item: ShoppingItem }) {
  if (item.sources.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {item.sources.map((s) => (
        <a
          key={`${s.isPublic ? "p" : "o"}:${s.recipeId}`}
          href={s.isPublic ? publicHref(s.recipeId) : jobHref(s.recipeId)}
          className="max-w-full truncate rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--sunken))] px-2 py-0.5 text-[11px] text-[hsl(var(--ink-muted))] transition-colors hover:border-[hsl(var(--accent-fill))] hover:text-[hsl(var(--accent-text))]"
        >
          {s.title}
        </a>
      ))}
    </div>
  );
}

function ItemEditor({
  item,
  onSave,
  onCancel,
}: {
  item: ShoppingItem;
  onSave: (edit: { amount: string; item: string; note: string }) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(formatAmount(item));
  const [name, setName] = useState(item.item);
  const [note, setNote] = useState(item.note ?? "");
  return (
    <form
      className="flex-1 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ amount, item: name, note });
      }}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
    >
      <div className="grid grid-cols-[96px_1fr] gap-2">
        <Input aria-label="Amount" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} maxLength={40} autoFocus />
        <Input aria-label="Item" placeholder="Item" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
      </div>
      <Input aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm">
          Save
        </Button>
      </div>
    </form>
  );
}

function ItemRow({ item, onError }: { item: ShoppingItem; onError: (message: string) => void }) {
  const [editing, setEditing] = useState(false);
  const amount = formatAmount(item);

  if (editing) {
    return (
      <li className="flex items-start gap-3 px-3 py-3">
        <ItemEditor
          item={item}
          onCancel={() => setEditing(false)}
          onSave={(edit) => {
            apply((l) => editItem(l, item.id, edit), onError);
            setEditing(false);
          }}
        />
      </li>
    );
  }

  return (
    <li className="checkbox-row group flex items-start gap-3 px-3 py-2.5">
      <Checkbox
        checked={item.checked}
        onChange={() => apply((l) => toggleItem(l, item.id), onError)}
        ariaLabel={`Mark ${item.item} as bought`}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          className="block w-full text-left text-[15px] leading-snug"
          onClick={() => apply((l) => toggleItem(l, item.id), onError)}
        >
          <span className="checkbox-strike">
            {amount && <span className="font-semibold tabular-nums">{amount} </span>}
            <span>{item.item}</span>
            {item.note && <span className={item.checked ? undefined : "text-[hsl(var(--ink-muted))]"}>, {item.note}</span>}
          </span>
        </button>
        {!item.checked && <SourceChips item={item} />}
      </div>
      <div className="-mr-1 flex shrink-0 items-center">
        {!item.checked && (
          <button
            type="button"
            aria-label={`Edit ${item.item}`}
            onClick={() => setEditing(true)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-[hsl(var(--ink-faint))] transition-colors hover:bg-[hsl(var(--accent-tint))] hover:text-[hsl(var(--ink))]"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          aria-label={`Remove ${item.item}`}
          onClick={() => apply((l) => removeItem(l, item.id), onError)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-[hsl(var(--ink-faint))] transition-colors hover:bg-[hsl(var(--accent-tint))] hover:text-[hsl(var(--ink))]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

function ItemCard({ items, onError, muted }: { items: ShoppingItem[]; onError: (m: string) => void; muted?: boolean }) {
  return (
    <ul
      className={cn(
        "divide-y divide-[hsl(var(--border))] rounded-[10px] border border-[hsl(var(--border))]",
        muted ? "bg-[hsl(var(--sunken))]" : "bg-[hsl(var(--surface))]",
      )}
    >
      {items.map((item) => (
        <ItemRow key={item.id} item={item} onError={onError} />
      ))}
    </ul>
  );
}

/** The shopping list page, #/list. */
export function ShoppingList() {
  const state = useShoppingList();
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  if (state.status === "loading") {
    return <div className="mx-auto max-w-2xl px-4 py-10 text-sm text-[hsl(var(--ink-muted))]">Loading your list…</div>;
  }
  if (state.status === "signed-out") {
    return (
      <div className="mx-auto max-w-md space-y-4 px-4 py-12">
        <h1 className="font-serif text-[34px] leading-[1.05] text-[hsl(var(--ink))]">Your shopping list</h1>
        <p className="text-[hsl(var(--ink-muted))]">Sign in to keep a shopping list on every device.</p>
        <SignInPanel />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p role="alert" className="text-sm text-[hsl(var(--danger))]">
          {state.message}
        </p>
      </div>
    );
  }

  const { list } = state;
  const { groups, checked } = groupForDisplay(list);
  const toBuy = list.items.length - checked.length;
  const text = listToText(list);
  const error = actionError ?? state.error ?? null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("ok");
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied("failed");
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:py-10">
      <div className="space-y-3">
        <div className="space-y-1">
          <h1 className="font-serif text-[34px] leading-[1.05] tracking-[-0.01em] text-[hsl(var(--ink))] sm:text-[44px]">
            Shopping list
          </h1>
          <p className="text-sm tabular-nums text-[hsl(var(--ink-muted))]">
            {list.items.length === 0
              ? IS_CLOUD
                ? "Synced with your account."
                : "Kept in this browser."
              : `${toBuy} to buy${checked.length > 0 ? ` · ${checked.length} checked` : ""}`}
          </p>
        </div>
        {list.items.length > 0 && (
          <div className="no-print flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={copy} disabled={!text}>
              {copied === "ok" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied === "ok" ? "Copied" : "Copy as text"}
            </Button>
            {checked.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => apply((l) => clearChecked(l), setActionError)}>
                <Check className="h-3.5 w-3.5" /> Clear checked
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="More list actions"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[hsl(var(--border-strong))] text-[hsl(var(--ink-muted))] transition-colors hover:bg-[hsl(var(--accent-tint))] hover:text-[hsl(var(--ink))]"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setConfirmClear(true)} className="text-[hsl(var(--danger))]">
                  <Trash2 className="h-3.5 w-3.5" /> Clear all
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        {copied === "failed" && (
          <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm text-[hsl(var(--ink-muted))]">Couldn't copy automatically — select the list below and copy it.</p>
              <button
                type="button"
                onClick={() => setCopied(null)}
                className="shrink-0 text-sm font-medium text-[hsl(var(--accent-text))] underline-offset-4 hover:underline"
              >
                Hide
              </button>
            </div>
            <textarea
              readOnly
              value={text}
              rows={Math.min(12, text.split("\n").length + 1)}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded-[var(--radius-control)] border border-[hsl(var(--border))] bg-[hsl(var(--sunken))] p-3 font-mono text-xs"
            />
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-[hsl(var(--danger))]">
            {error}
          </p>
        )}
      </div>

      {list.items.length === 0 ? (
        <div className="space-y-3 rounded-[10px] border border-dashed border-[hsl(var(--border-strong))] px-6 py-10 text-center">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-[12px] bg-[hsl(var(--accent-tint))] text-[hsl(var(--accent-text))]">
            <ShoppingBasket className="h-5 w-5" />
          </span>
          <p className="font-medium text-[hsl(var(--ink))]">Your list is empty</p>
          <p className="mx-auto max-w-sm text-sm text-[hsl(var(--ink-muted))]">
            Open a recipe and press <span className="font-medium text-[hsl(var(--ink))]">Add to shopping list</span> — amounts
            follow the servings you pick, and repeats are merged.
          </p>
          <div className="flex justify-center gap-2 pt-1">
            <Button size="sm" variant="outline" asChild>
              <a href="#/">Your recipes</a>
            </Button>
            {IS_CLOUD && (
              <Button size="sm" variant="outline" asChild>
                <a href={exploreHref()}>Explore</a>
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.category} className="space-y-2">
              <h2 className={LABEL}>{g.label}</h2>
              <ItemCard items={g.items} onError={setActionError} />
            </section>
          ))}
          {checked.length > 0 && (
            <section className="space-y-2">
              <h2 className={LABEL}>Checked · {checked.length}</h2>
              <ItemCard items={checked} onError={setActionError} muted />
            </section>
          )}
        </div>
      )}

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear the whole list?</DialogTitle>
            <DialogDescription>
              This removes all {list.items.length} item{list.items.length === 1 ? "" : "s"}, checked or not. Your recipes aren't affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                apply(() => clearAll(), setActionError);
                setConfirmClear(false);
              }}
            >
              Clear all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
