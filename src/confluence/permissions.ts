import { normalizeConfluenceBaseUrl } from './baseUrl';

export type ConfluenceHostPermission = {
  origins: [string];
};

export function getConfluenceHostPermission(normalizedBaseUrl: string): ConfluenceHostPermission {
  const result = normalizeConfluenceBaseUrl(normalizedBaseUrl);

  if (!result.ok) {
    throw new Error(result.error);
  }

  return { origins: [`${result.origin}/*`] };
}

export async function requestConfluenceHostPermission(normalizedBaseUrl: string): Promise<boolean> {
  return chrome.permissions.request(getConfluenceHostPermission(normalizedBaseUrl));
}

export async function hasConfluenceHostPermission(normalizedBaseUrl: string): Promise<boolean> {
  return chrome.permissions.contains(getConfluenceHostPermission(normalizedBaseUrl));
}
