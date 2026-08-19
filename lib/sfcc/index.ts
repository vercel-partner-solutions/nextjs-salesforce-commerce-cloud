import {
  helpers,
  ShopperBaskets,
  ShopperBasketsTypes,
  ShopperLogin,
  ShopperOrders,
  ShopperOrdersTypes,
  ShopperProducts,
  ShopperSearch,
} from "commerce-sdk-isomorphic";
import { TAGS } from "lib/constants";
import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import { cookies, headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { defaultSort, storeCatalog } from "./constants";
import {
  reshapeBasket,
  reshapeCategories,
  reshapeOrder,
  reshapeProduct,
  reshapeProductItem,
  reshapeProducts,
  reshapeShippingMethods,
} from "./reshape";
import { ensureSDKResponseError } from "./type-guards";
import { CartItem, Product } from "./types";
import { getCardType, maskCardNumber } from "./utils";

const apiConfig = {
  throwOnBadResponse: true,
  // Use the platform fetch. Without this the SDK falls back to its bundled
  // node-fetch 2.6.13, whose Request constructor calls the deprecated
  // url.parse() (DEP0169) and gets bundled into the server output.
  fetch: globalThis.fetch,
  // Route every call through a proxy in front of SCAPI. The SDK replaces the
  // origin and prepends this path, so shortCode is unused while it is set.
  // Leave SFCC_PROXY empty to talk to SCAPI directly.
  proxy: process.env.SFCC_PROXY || undefined,
  parameters: {
    clientId: process.env.SFCC_CLIENT_ID || "",
    organizationId: process.env.SFCC_ORGANIZATIONID || "",
    shortCode: process.env.SFCC_SHORTCODE || "",
    siteId: process.env.SFCC_SITEID || "",
  },
};

export async function getCollections() {
  "use cache";
  cacheTag(TAGS.collections);
  cacheLife("days");
  return await getSFCCCollections();
}

export async function getCollection(handle: string) {
  const collections = await getCollections();
  return collections.find((c) => c.handle === handle);
}

export async function getProduct(id: string) {
  "use cache";
  cacheTag(TAGS.products);
  cacheLife("days");
  return getSFCCProduct(id);
}

export async function getCollectionProducts({
  collection,
  limit = 100,
  sortKey,
}: {
  collection: string;
  limit?: number;
  sortKey?: string;
}) {
  "use cache";
  cacheTag(TAGS.products, TAGS.collections);
  cacheLife("days");
  const products = await searchProducts({
    categoryId: collection,
    limit,
    sortKey,
  });

  // The hidden-homepage-* categories only exist in custom site data. When
  // running against a catalog without them (e.g. the Salesforce demo
  // backend), fall back to new arrivals so the homepage still has content.
  if (!products.length && collection.startsWith("hidden-homepage")) {
    return await searchProducts({ categoryId: "newarrivals", limit, sortKey });
  }

  return products;
}

export async function getProducts({
  query,
  sortKey,
}: {
  query?: string;
  sortKey?: string;
  reverse?: boolean;
}) {
  "use cache";
  cacheTag(TAGS.products);
  cacheLife("days");
  return await searchProducts({ query, sortKey });
}

export async function createCart() {
  let guestToken = (await cookies()).get("guest_token")?.value;

  // if there is not a guest token, get one and store it in a cookie
  if (!guestToken) {
    const tokenResponse = await getGuestUserAuthToken();
    guestToken = tokenResponse.access_token;
    (await cookies()).set("guest_token", guestToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 60 * 30,
      path: "/",
    });
  }

  // get the guest config
  const config = await getGuestUserConfig(guestToken);

  // initialize the basket client
  const basketClient = new ShopperBaskets(config);

  // create an empty ShopperBaskets.Basket
  const createdBasket = await basketClient.createBasket({
    body: {},
  });

  const cartItems = await getCartItems(createdBasket);

  return reshapeBasket(createdBasket, cartItems);
}

export async function getCart() {
  const cartId = (await cookies()).get("cartId")?.value!;
  // get the guest token to get the correct guest cart
  const guestToken = (await cookies()).get("guest_token")?.value;

  const config = await getGuestUserConfig(guestToken);

  if (!cartId) return;

  try {
    const basketClient = new ShopperBaskets(config);

    const basket = await basketClient.getBasket({
      parameters: {
        basketId: cartId,
      },
    });

    if (!basket?.basketId) return;

    const cartItems = await getCartItems(basket);
    return reshapeBasket(basket, cartItems);
  } catch (e: any) {
    console.log(await e.response.text());
    return;
  }
}

export async function addToCart(
  lines: { merchandiseId: string; quantity: number }[],
) {
  const cartId = (await cookies()).get("cartId")?.value!;
  // get the guest token to get the correct guest cart
  const guestToken = (await cookies()).get("guest_token")?.value;
  const config = await getGuestUserConfig(guestToken);

  try {
    const basketClient = new ShopperBaskets(config);

    const basket = await basketClient.addItemToBasket({
      parameters: {
        basketId: cartId,
      },
      body: lines.map((line) => {
        return {
          productId: line.merchandiseId,
          quantity: line.quantity,
        };
      }),
    });

    if (!basket?.basketId) return;

    const cartItems = await getCartItems(basket);
    return reshapeBasket(basket, cartItems);
  } catch (e: any) {
    console.log(await e.response.text());
    return;
  }
}

export async function removeFromCart(lineIds: string[]) {
  const cartId = (await cookies()).get("cartId")?.value!;
  // Next Commerce only sends one lineId at a time
  if (lineIds.length !== 1)
    throw new Error("Invalid number of line items provided");

  // get the guest token to get the correct guest cart
  const guestToken = (await cookies()).get("guest_token")?.value;
  const config = await getGuestUserConfig(guestToken);

  const basketClient = new ShopperBaskets(config);

  const basket = await basketClient.removeItemFromBasket({
    parameters: {
      basketId: cartId,
      itemId: lineIds[0]!,
    },
  });

  const cartItems = await getCartItems(basket);
  return reshapeBasket(basket, cartItems);
}

export async function updateCart(
  lines: { id: string; merchandiseId: string; quantity: number }[],
) {
  const cartId = (await cookies()).get("cartId")?.value!;
  // get the guest token to get the correct guest cart
  const guestToken = (await cookies()).get("guest_token")?.value;
  const config = await getGuestUserConfig(guestToken);

  const basketClient = new ShopperBaskets(config);

  // ProductItem quantity can not be updated through the API
  // Quantity updates need to remove all items from the cart and add them back with updated quantities
  // See: https://developer.salesforce.com/docs/commerce/commerce-api/references/shopper-baskets?meta=updateBasket

  // create removePromises for each line
  const removePromises = lines.map((line) =>
    basketClient.removeItemFromBasket({
      parameters: {
        basketId: cartId,
        itemId: line.id,
      },
    }),
  );

  // wait for all removals to resolve
  await Promise.all(removePromises);

  // create addPromises for each line
  const addPromises = lines.map((line) =>
    basketClient.addItemToBasket({
      parameters: {
        basketId: cartId,
      },
      body: [
        {
          productId: line.merchandiseId,
          quantity: line.quantity,
        },
      ],
    }),
  );

  // wait for all additions to resolve
  await Promise.all(addPromises);

  // all updates are done, get the updated basket
  const updatedBasket = await basketClient.getBasket({
    parameters: {
      basketId: cartId,
    },
  });

  const cartItems = await getCartItems(updatedBasket);
  return reshapeBasket(updatedBasket, cartItems);
}

export async function getProductRecommendations(productId: string) {
  // The Shopper APIs do not provide a recommendation service. This is typically
  // done through Einstein, which isn't available in this environment.
  // For now, we refetch the product and use the categoryId to get recommendations.
  // This fills the need for now and doesn't require changes to the UI.

  "use cache";
  cacheTag(TAGS.products);
  cacheLife("days");

  const categoryId = (await getProduct(productId))?.categoryId;

  if (!categoryId) return [];

  const products = await getCollectionProducts({
    collection: categoryId,
    limit: 11,
  });

  // Filter out the product we're already looking at.
  return products.filter((product) => product.id !== productId);
}

export async function revalidate(req: NextRequest) {
  const collectionWebhooks = [
    "collections/create",
    "collections/delete",
    "collections/update",
  ];
  const productWebhooks = [
    "products/create",
    "products/delete",
    "products/update",
  ];
  const topic = (await headers()).get("x-sfcc-topic") || "unknown";
  const secret = req.nextUrl.searchParams.get("secret");
  const isCollectionUpdate = collectionWebhooks.includes(topic);
  const isProductUpdate = productWebhooks.includes(topic);

  if (!secret || secret !== process.env.SFCC_REVALIDATION_SECRET) {
    console.error("Invalid revalidation secret.");
    return NextResponse.json({ status: 200 });
  }

  if (!isCollectionUpdate && !isProductUpdate) {
    // We don't need to revalidate anything for any other topics.
    return NextResponse.json({ status: 200 });
  }

  if (isCollectionUpdate) {
    revalidateTag(TAGS.collections, "max");
  }

  if (isProductUpdate) {
    revalidateTag(TAGS.products, "max");
  }

  return NextResponse.json({ status: 200, revalidated: true, now: Date.now() });
}

// Must be registered as a redirect URI on the SLAS client. It is never
// visited: on the server the SDK only parses the authorize redirect for its
// code and usid params.
const SLAS_REDIRECT_URI = "http://localhost:3000/callback";

async function getGuestUserAuthToken(): Promise<{ access_token: string }> {
  const loginClient = new ShopperLogin(apiConfig);
  const clientSecret = process.env.SFCC_SECRET;
  try {
    // Public SLAS clients (no secret, e.g. Salesforce's hosted demo backend)
    // use the guest authorization-code + PKCE flow.
    if (!clientSecret) {
      return await helpers.loginGuestUser({
        slasClient: loginClient,
        parameters: { redirectURI: SLAS_REDIRECT_URI },
      });
    }

    // Private SLAS clients (own sandbox) authenticate with their secret.
    return await helpers.loginGuestUserPrivate({
      slasClient: loginClient,
      parameters: {},
      credentials: { clientSecret },
    });
  } catch (e) {
    const error = await ensureSDKResponseError(
      e,
      "Failed to retrieve access token",
    );
    throw new Error(error);
  }
}

async function getGuestUserConfig(token?: string) {
  const guestToken = token || (await getGuestUserAuthToken()).access_token;
  return {
    ...apiConfig,
    headers: {
      authorization: `Bearer ${guestToken}`,
    },
  };
}

async function getSFCCCollections() {
  const config = await getGuestUserConfig();
  const productsClient = new ShopperProducts(config);

  const result = await productsClient.getCategories({
    parameters: {
      ids: storeCatalog.ids,
    },
  });

  return reshapeCategories(result?.data || []);
}

async function getSFCCProduct(id: string) {
  const config = await getGuestUserConfig();
  const productsClient = new ShopperProducts(config);

  const product = await productsClient.getProduct({
    parameters: {
      id,
    },
  });

  try {
    return reshapeProduct(product);
  } catch {
    // The product exists but can't be displayed (e.g. missing name or images
    // in the catalog) — treat it as not found rather than erroring the page.
    return undefined;
  }
}

async function searchProducts(options: {
  query?: string;
  categoryId?: string;
  sortKey?: string;
  limit?: number;
}) {
  const {
    query,
    categoryId,
    sortKey = defaultSort.sortKey,
    limit = 100,
  } = options;
  const config = await getGuestUserConfig();

  const searchClient = new ShopperSearch(config);
  const searchResults = await searchClient.productSearch({
    parameters: {
      q: query || "",
      ...(categoryId ? { refine: `cgid=${categoryId}` } : {}),
      sort: sortKey,
      limit,
    },
  });

  const productsClient = new ShopperProducts(config);

  const results = await Promise.all(
    (searchResults.hits || []).map((product) => {
      return (
        productsClient
          .getProduct({
            parameters: {
              id: product.productId,
            },
          })
          // One unfetchable product shouldn't fail the entire search
          .catch(() => null)
      );
    }),
  );

  return reshapeProducts(results.filter((product) => product !== null));
}

// Accepts either shape: Order and Basket diverged in v5 (Order.channelType
// gained "chatgpt"), but the fields read below are identical on both.
async function getCartItems(
  createdBasket: ShopperBasketsTypes.Basket | ShopperOrdersTypes.Order,
) {
  const cartItems: CartItem[] = [];

  if (createdBasket.productItems) {
    const productsInCart: Product[] = [];

    // Fetch all matching products for items in the cart
    await Promise.all(
      createdBasket.productItems
        .filter((l) => l.productId)
        .map(async (l) => {
          const product = await getProduct(l.productId!);
          if (product) {
            productsInCart.push(product);
          }
        }),
    );

    // Reshape the sfcc items and push them onto the cartItems
    createdBasket.productItems.map((productItem) => {
      cartItems.push(
        reshapeProductItem(
          productItem,
          createdBasket.currency || "USD",
          productsInCart.find((p) => p.id === productItem.productId)!,
        ),
      );
    });
  }

  return cartItems;
}

export async function updateCustomerInfo(email: string) {
  const cartId = (await cookies()).get("cartId")?.value!;
  const guestToken = (await cookies()).get("guest_token")?.value;
  const config = await getGuestUserConfig(guestToken);

  try {
    const basketClient = new ShopperBaskets(config);

    await basketClient.updateCustomerForBasket({
      parameters: {
        basketId: cartId,
      },
      body: {
        email: email,
      },
    });
  } catch (e) {
    const error = await ensureSDKResponseError(
      e,
      "Error updating basket email",
    );
    throw new Error(error);
  }
}

export async function updateShippingAddress(
  shippingAddress: ShopperBasketsTypes.OrderAddress,
) {
  const cartId = (await cookies()).get("cartId")?.value!;
  const guestToken = (await cookies()).get("guest_token")?.value;
  const config = await getGuestUserConfig(guestToken);

  try {
    const basketClient = new ShopperBaskets(config);

    // Use 'me' as the shipment ID, which refers to the current customer's default shipment
    await basketClient.updateShippingAddressForShipment({
      parameters: {
        basketId: cartId,
        shipmentId: "me",
      },
      body: shippingAddress,
    });
  } catch (e) {
    const error = await ensureSDKResponseError(
      e,
      "Error updating basket shipping address",
    );
    throw new Error(error);
  }
}

export async function updateBillingAddress(
  billingAddress: ShopperBasketsTypes.OrderAddress,
) {
  const cartId = (await cookies()).get("cartId")?.value!;
  const guestToken = (await cookies()).get("guest_token")?.value;
  const config = await getGuestUserConfig(guestToken);

  try {
    const basketClient = new ShopperBaskets(config);

    await basketClient.updateBillingAddressForBasket({
      parameters: {
        basketId: cartId,
      },
      body: billingAddress,
    });
  } catch (e) {
    const error = await ensureSDKResponseError(
      e,
      "Error updating basket billing address",
    );
    throw new Error(error);
  }
}

export async function updateShippingMethod(shippingMethodId: string) {
  const cartId = (await cookies()).get("cartId")?.value!;
  const guestToken = (await cookies()).get("guest_token")?.value;
  const config = await getGuestUserConfig(guestToken);

  try {
    const basketClient = new ShopperBaskets(config);

    // Use 'me' as the shipment ID, which refers to the current customer's default shipment
    await basketClient.updateShippingMethodForShipment({
      parameters: {
        basketId: cartId,
        shipmentId: "me",
      },
      body: {
        id: shippingMethodId,
      },
    });
  } catch (e) {
    const error = await ensureSDKResponseError(
      e,
      "Error updating shipping method",
    );
    throw new Error(error);
  }
}

export async function addPaymentMethod(paymentData: {
  cardNumber: string;
  cardholderName: string;
  expirationMonth: number;
  expirationYear: number;
  securityCode: string;
}) {
  const cartId = (await cookies()).get("cartId")?.value!;
  const guestToken = (await cookies()).get("guest_token")?.value;
  const config = await getGuestUserConfig(guestToken);

  try {
    const basketClient = new ShopperBaskets(config);

    // Using the simplest example with credit card payment type for demo purposes.
    // Real implementations might also incorporate 3p payment providers as well.
    await basketClient.addPaymentInstrumentToBasket({
      parameters: {
        basketId: cartId,
      },
      body: {
        amount: 0, // Calculated by server based on basket total
        paymentMethodId: "CREDIT_CARD",
        paymentCard: {
          cardType: getCardType(paymentData.cardNumber),
          maskedNumber: maskCardNumber(paymentData.cardNumber),
          expirationMonth: paymentData.expirationMonth,
          expirationYear: paymentData.expirationYear,
        },
      },
    });

    // In a real implementation, the security code would be handled by the payment processor
    // and not stored in the commerce system
  } catch (e) {
    const error = await ensureSDKResponseError(
      e,
      "Error adding payment instrument to basket",
    );
    throw new Error(error);
  }
}

export async function getShippingMethods() {
  const cartId = (await cookies()).get("cartId")?.value!;
  const guestToken = (await cookies()).get("guest_token")?.value;
  const config = await getGuestUserConfig(guestToken);

  try {
    const basketClient = new ShopperBaskets(config);

    // Use 'me' as the shipment ID, which refers to the current customer's default shipment
    const shippingMethods = await basketClient.getShippingMethodsForShipment({
      parameters: {
        basketId: cartId,
        shipmentId: "me",
      },
    });

    return reshapeShippingMethods(shippingMethods);
  } catch (e) {
    const error = await ensureSDKResponseError(
      e,
      "Error fetching shipping methods",
    );
    throw new Error(error);
  }
}

export async function placeOrder() {
  const cartId = (await cookies()).get("cartId")?.value!;
  const guestToken = (await cookies()).get("guest_token")?.value;
  const config = await getGuestUserConfig(guestToken);

  try {
    const ordersClient = new ShopperOrders(config);

    // NOTE: Need to cast to the proper type. Looks like a bug in the SDK's typedefs.
    const order = (await ordersClient.createOrder({
      body: { basketId: cartId },
    })) as ShopperOrdersTypes.Order;

    const cartItems = await getCartItems(order);
    return reshapeOrder(order, cartItems);
  } catch (e) {
    const error = await ensureSDKResponseError(e, "Error placing order");
    throw new Error(error);
  }
}

export async function getCheckoutOrder() {
  const orderId = (await cookies()).get("orderId")?.value;
  const guestToken = (await cookies()).get("guest_token")?.value;
  const config = await getGuestUserConfig(guestToken);

  if (!orderId) {
    return;
  }

  try {
    const ordersClient = new ShopperOrders(config);

    // NOTE: Need to cast to the proper type. Looks like a bug in the SDK's typedefs.
    const order = (await ordersClient.getOrder({
      parameters: {
        orderNo: orderId,
      },
    })) as ShopperOrdersTypes.Order;

    const cartItems = await getCartItems(order);
    return reshapeOrder(order, cartItems);
  } catch (e) {
    const sdkError = await ensureSDKResponseError(e);
    if (sdkError) {
      return;
    }
    throw e;
  }
}
