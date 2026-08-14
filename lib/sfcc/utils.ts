import { Cart } from "lib/sfcc/types";
import { z } from "zod";
import { CheckoutStep, checkoutStepRoutes } from "./constants";

export type ExtractVariables<T> = T extends { variables: object }
  ? T["variables"]
  : never;

export function getCartCheckoutStep(cart: Cart | undefined): CheckoutStep {
  if (!cart) return CheckoutStep.Information;

  const hasPayment = !!cart.paymentInstruments?.length;
  const hasShippingMethod = !!cart.shippingMethod;
  const hasShippingAddress = !!cart.shippingAddress;

  if (hasShippingAddress && hasShippingMethod) {
    return CheckoutStep.Payment;
  }

  if (hasShippingAddress) {
    return CheckoutStep.Shipping;
  }

  return CheckoutStep.Information;
}

export function getPathForCartCheckoutStep(cart: Cart | undefined): string {
  const step = getCartCheckoutStep(cart);
  return checkoutStepRoutes[step];
}

export function formatCreditCardNumber(value: string): string {
  // Remove all non-digit characters
  const digits = value.replace(/\D/g, "");

  // Format based on card type
  const cardType = getCardType(digits);

  if (cardType === "Amex") {
    // Format as XXXX XXXXXX XXXXX for Amex
    return digits
      .replace(/(\d{4})/, "$1 ")
      .replace(/(\d{4}) (\d{6})/, "$1 $2 ")
      .substring(0, 17); // Limit to 15 digits + 2 spaces
  } else {
    // Format as XXXX XXXX XXXX XXXX for other cards
    return digits
      .replace(/(\d{4})/g, "$1 ")
      .trim()
      .substring(0, 19); // Limit to 16 digits + 3 spaces
  }
}

export function getCardType(cardNumber: string): string {
  // Remove all non-digit characters
  const digits = cardNumber.replace(/\D/g, "");

  // Basic card type detection based on first digits
  if (digits.startsWith("4")) {
    return "Visa";
  } else if (/^5[1-5]/.test(digits)) {
    return "MasterCard";
  } else if (/^3[47]/.test(digits)) {
    return "Amex";
  } else if (/^6(?:011|5)/.test(digits)) {
    return "Discover";
  } else {
    return "Unknown";
  }
}

export function stripCardFormatting(cardNumber: string): string {
  return cardNumber.replace(/\D/g, "");
}

export function validateCardNumber(cardNumber: string): boolean {
  const digits = cardNumber.replace(/\D/g, "");

  // Check if the card number is empty or has invalid length
  if (!digits || digits.length < 12 || digits.length > 19) {
    return false;
  }

  // Luhn algorithm
  let sum = 0;
  let shouldDouble = false;

  // Loop through the digits in reverse
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits.charAt(i));

    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

export function maskCardNumber(cardNumber: string): string {
  if (cardNumber.length < 4) return cardNumber;
  const lastFourDigits = cardNumber.slice(-4);
  return `************${lastFourDigits}`;
}

export const months = Array.from({ length: 12 }, (_, i) => {
  const month = i + 1;
  return {
    value: month.toString().padStart(2, "0"),
    label: month.toString().padStart(2, "0"),
  };
});

const currentYear = new Date().getFullYear();
export const years = Array.from({ length: 10 }, (_, i) => {
  const year = currentYear + i;
  return {
    value: year.toString(),
    label: year.toString(),
  };
});

export const formatUSZip = (value: string): string => {
  // Remove non-numeric characters
  const nums = value.replace(/[^\d]/g, "");

  // Format as XXXXX or XXXXX-XXXX
  if (nums.length <= 5) {
    return nums;
  } else {
    return `${nums.slice(0, 5)}-${nums.slice(5, 9)}`;
  }
};

export const formatCAPostal = (value: string): string => {
  // Remove non-alphanumeric characters
  const cleaned = value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

  // Format as A1A 1A1
  if (cleaned.length <= 3) {
    return cleaned;
  } else {
    return `${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)}`.trim();
  }
};

export const formatUKPostcode = (value: string): string => {
  // Remove non-alphanumeric characters and convert to uppercase
  const cleaned = value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

  // UK postcodes have variable length but generally split into outward + inward codes
  if (cleaned.length <= 4) {
    return cleaned;
  } else {
    // Split between outward code and inward code (last 3 characters)
    const outwardLength = cleaned.length - 3;
    return `${cleaned.slice(0, outwardLength)} ${cleaned.slice(outwardLength)}`.trim();
  }
};

export const formatUSPhone = (value: string): string => {
  // Remove non-numeric characters
  const nums = value.replace(/[^\d]/g, "");

  if (nums.length <= 3) {
    return nums;
  } else if (nums.length <= 6) {
    return `(${nums.slice(0, 3)}) ${nums.slice(3)}`;
  } else {
    return `(${nums.slice(0, 3)}) ${nums.slice(3, 6)}-${nums.slice(6, 10)}`;
  }
};

export const formatCAPhone = (value: string): string => {
  return formatUSPhone(value);
};

export const formatUKPhone = (value: string): string => {
  // No formatting for UK phone numbers to keep things simple
  return value;
};

// Helper for returning the expected error state to actions instead of throwing.
export const handleFormActionError = (
  error: unknown,
  defaultMessage: string,
) => {
  return {
    errors: {
      formErrors: [(error as Error)?.message || defaultMessage],
    },
  };
};

type PrefixedShape<T extends z.ZodObject<any>, P extends string> = {
  [K in keyof T["shape"] as K extends string
    ? `${P}.${K}`
    : never]: T["shape"][K];
};

// Creates a new Zod schema with all keys prefixed with the given string.
export const prefixSchema = <T extends z.ZodObject<any>, P extends string>(
  schema: T,
  prefix: P,
): z.ZodObject<PrefixedShape<T, P>> => {
  if (!prefix) return schema as z.ZodObject<PrefixedShape<T, P>>;

  const shape = schema.shape;
  const newShape = {} as PrefixedShape<T, P>;

  for (const [key, value] of Object.entries(shape)) {
    (newShape as any)[`${prefix}.${key}`] = value;
  }

  return z.object(newShape);
};

export const validateEnvironmentVariables = () => {
  // SFCC_SECRET is intentionally not required: public SLAS clients
  // (e.g. the Salesforce demo backend) have no secret.
  const requiredEnvironmentVariables = [
    "SITE_NAME",
    "SFCC_CLIENT_ID",
    "SFCC_ORGANIZATIONID",
    "SFCC_SHORTCODE",
    "SFCC_SITEID",
    "SFCC_REVALIDATION_SECRET",
  ];
  const missingEnvironmentVariables = [] as string[];

  requiredEnvironmentVariables.forEach((envVar) => {
    if (!process.env[envVar]) {
      missingEnvironmentVariables.push(envVar);
    }
  });

  if (missingEnvironmentVariables.length) {
    throw new Error(
      `The following environment variables are missing. Your site will not work without them. Read more: https://vercel.com/docs/integrations/shopify#configure-environment-variables\n\n${missingEnvironmentVariables.join(
        "\n",
      )}\n`,
    );
  }
};
