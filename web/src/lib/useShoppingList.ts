import { useEffect, useState } from "react";
import { shoppingList, type ShoppingListState } from "@/backend";

/** The live shopping list (Firestore in cloud mode, localStorage otherwise). */
export function useShoppingList(): ShoppingListState {
  const [state, setState] = useState<ShoppingListState>({ status: "loading" });
  useEffect(() => shoppingList.subscribe(setState), []);
  return state;
}
