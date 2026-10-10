import { z } from "zod";

// Shopping list (cloud mode: users/{uid}/lists/shopping, written by the browser and checked
// by firebase/firestore.rules; other modes keep the same shape in localStorage). Items are
// merged by (normalized item, unit family) when added from several recipes — the merge and
// unit maths live in web/src/lib/shopping.ts.

export const SHOPPING_LIST_DOC = "shopping"; // users/{uid}/lists/shopping
export const MAX_SHOPPING_ITEMS = 300;

export const ShoppingSource = z.object({
  recipeId: z.string().max(64), // private recipe id or public id
  title: z.string().max(200),
  isPublic: z.boolean(), // link to /r/{id} (true) or #/jobs/{id} (false)
});
export type ShoppingSource = z.infer<typeof ShoppingSource>;

export const ShoppingItem = z.object({
  id: z.string().max(64),
  item: z.string().min(1).max(120), // "garlic"
  quantity: z.number().nullable(), // null = "some" / unspecified
  unit: z.string().max(30).nullable(),
  note: z.string().max(120).nullable(), // prep or the cook's own note
  sources: z.array(ShoppingSource).max(20),
  checked: z.boolean(),
  addedAt: z.string(), // ISO
});
export type ShoppingItem = z.infer<typeof ShoppingItem>;

export const ShoppingListDoc = z.object({
  items: z.array(ShoppingItem).max(MAX_SHOPPING_ITEMS),
  updatedAt: z.string(), // ISO
});
export type ShoppingListDoc = z.infer<typeof ShoppingListDoc>;
