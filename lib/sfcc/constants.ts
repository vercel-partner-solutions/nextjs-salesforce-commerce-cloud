import { z } from "zod";

export type SortFilterItem = {
  title: string;
  slug: string | null;
  sortKey:
    | "best-matches"
    | "price-low-to-high"
    | "price-high-to-low"
    | "product-name-ascending"
    | "product-name-descending";
  reverse: boolean;
};

export const storeCatalog = {
  ids: ["mens", "womens", "newarrivals", "top-seller"],
};

export const defaultSort: SortFilterItem = {
  title: "Best Matches",
  slug: "best-matches",
  sortKey: "best-matches",
  reverse: false,
};

export const sorting: SortFilterItem[] = [
  defaultSort,
  {
    title: "Price Low to High",
    slug: "price-low-to-high",
    sortKey: "price-low-to-high",
    reverse: false,
  },
  {
    title: "Price High to Low",
    slug: "price-high-to-low",
    sortKey: "price-high-to-low",
    reverse: false,
  },
  {
    title: "Name A - Z",
    slug: "product-name-ascending",
    sortKey: "product-name-ascending",
    reverse: false,
  },
  {
    title: "Name Z - A",
    slug: "product-name-descending",
    sortKey: "product-name-descending",
    reverse: false,
  },
];

// Type for the state returned from our form actions. Provides
// additional type safety for error fields.
export type FormActionState<T extends z.ZodTypeAny = z.ZodTypeAny> =
  | {
      errors: {
        formErrors?: string[];
        fieldErrors?: z.inferFlattenedErrors<T>["fieldErrors"];
      };
    }
  | undefined;

export enum CheckoutStep {
  Information = 1,
  Shipping,
  Payment,
  Confirmation,
}

export const checkoutStepRoutes: Record<CheckoutStep, string> = {
  [CheckoutStep.Information]: "/checkout/information",
  [CheckoutStep.Shipping]: "/checkout/shipping",
  [CheckoutStep.Payment]: "/checkout/payment",
  [CheckoutStep.Confirmation]: "/checkout/confirmation",
};

export type CountryCode = "US" | "CA" | "UK";

export type PostalCodeConfig = {
  label: string;
  placeholder: string;
  format: (value: string) => string;
};
