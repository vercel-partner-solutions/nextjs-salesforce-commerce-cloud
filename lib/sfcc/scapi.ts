import { getGuestUserAuthToken } from './auth';
import { Collection } from './types';
import { ExtractVariables, salesforceFetch } from './utils';

export async function scapiFetch<T>(options: {
  method: 'POST' | 'GET';
  apiEndpoint: string;
  cache?: RequestCache;
  headers?: HeadersInit;
  tags?: string[];
  variables?: ExtractVariables<T>;
}): Promise<{ status: number; body: T } | never> {
  const scapiDomain = `https://${process.env.SFCC_SHORTCODE}.api.commercecloud.salesforce.com`;
  const apiEndpoint = `${scapiDomain}${options.apiEndpoint}?siteId=${process.env.SFCC_SITEID}`;
  return salesforceFetch<T>({
    ...options,
    apiEndpoint
  });
}

export async function fetchAccessToken() {
  return (await getGuestUserAuthToken()).access_token;
}

export async function fetchCollection(handle: string): Promise<Collection | undefined> {
  const accessToken = await fetchAccessToken();

  const response = await scapiFetch<Collection>({
    method: 'GET',
    apiEndpoint: `/product/shopper-products/v1/organizations/${process.env.SFCC_ORGANIZATIONID}/products/${handle}`,
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (response.status !== 200) {
    throw new Error('Failed to fetch collection');
  }

  return response.body;
}
