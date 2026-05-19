export const NOTION_OAUTH_CLIENT_ID_PLACEHOLDER = '__NOTION_OAUTH_CLIENT_ID__';
export const NOTION_OAUTH_CLIENT_ID_CONFIGURATION_ERROR = 'notion-oauth-client-id-not-configured';
export const NOTION_OAUTH_CLIENT_ID_CONFIGURATION_MESSAGE =
  'This extension build is missing Notion OAuth client configuration. Rebuild it with NOTION_OAUTH_CLIENT_ID set, then reconnect Notion.';

const BUILD_TIME_NOTION_OAUTH_CLIENT_ID = '';

export const notionOAuthClientConfig = {
  clientId: BUILD_TIME_NOTION_OAUTH_CLIENT_ID
};

export function isConfiguredNotionOAuthClientId(clientId: string): boolean {
  const normalizedClientId = clientId.trim();
  return normalizedClientId.length > 0 && normalizedClientId !== NOTION_OAUTH_CLIENT_ID_PLACEHOLDER;
}
