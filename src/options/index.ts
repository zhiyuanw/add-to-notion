import {
  hasConfluenceHostPermission,
  normalizeConfluenceBaseUrl,
  requestConfluenceHostPermission,
  type ConfluenceBaseUrlValidationError
} from '../confluence';
import {
  NOTION_OAUTH_CLIENT_ID_CONFIGURATION_ERROR,
  NOTION_OAUTH_CLIENT_ID_CONFIGURATION_MESSAGE,
  getNotionAuthorizationStatus,
  logoutNotion,
  searchNotionTargets,
  saveNotionTargetSelection,
  startNotionOAuth,
  type NotionAuthOptions
} from '../notion';
import type { NotionTarget } from '../shared/domain/models';
import {
  readConfluenceBaseUrl,
  readLocalStorageValue,
  saveConfluenceBaseUrl,
  storageKeys
} from '../shared/storage';

type ConfluenceOptionsState = {
  inputValue: string;
  savedBaseUrl?: string;
  validationMessage?: string;
  permissionGranted?: boolean;
  statusMessage?: string;
};

type NotionOptionsState = {
  connected: boolean;
  workspaceName?: string;
  requiresReauthorization: boolean;
  selectedTarget?: NotionTarget;
  searchQuery: string;
  searchResults: NotionTarget[];
  guidance?: string;
  statusMessage?: string;
};

type OptionsPageDependencies = {
  notion?: NotionAuthOptions & {
    createState?: () => string;
  };
};

type ConfluenceOptionsElements = {
  root: HTMLElement;
  form: HTMLFormElement;
  input: HTMLInputElement;
  error: HTMLElement;
  savedUrl: HTMLElement;
  permissionStatus: HTMLElement;
  grantButton: HTMLButtonElement;
  status: HTMLElement;
};

type NotionOptionsElements = {
  root: HTMLElement;
  authorizationStatus: HTMLElement;
  connectButton: HTMLButtonElement;
  logoutButton: HTMLButtonElement;
  searchInput: HTMLInputElement;
  searchButton: HTMLButtonElement;
  selectedTarget: HTMLElement;
  results: HTMLElement;
  guidance: HTMLElement;
  status: HTMLElement;
};

const validationMessages: Record<ConfluenceBaseUrlValidationError, string> = {
  'missing-url': 'Enter a Confluence base URL.',
  'invalid-url': 'Enter an absolute URL such as https://confluence.example.com/wiki.',
  'unsupported-scheme': 'Use an http or https Confluence URL.',
  'credentials-not-allowed': 'Remove username and password from the Confluence URL.',
  'query-not-allowed': 'Remove query parameters from the Confluence URL.',
  'fragment-not-allowed': 'Remove the URL fragment from the Confluence URL.'
};

export function renderConfluenceOptions(root: HTMLElement, state: ConfluenceOptionsState): ConfluenceOptionsElements {
  root.innerHTML = `
    <section aria-labelledby="confluence-settings-title">
      <h2 id="confluence-settings-title">Confluence settings</h2>
      <form id="confluence-base-url-form">
        <label for="confluence-base-url">Confluence base URL</label>
        <input id="confluence-base-url" name="confluenceBaseUrl" type="url" autocomplete="url" />
        <button type="submit">Save Confluence URL</button>
      </form>
      <p id="confluence-base-url-error" role="alert"></p>
      <p>Saved URL: <span id="saved-confluence-base-url">Not configured</span></p>
      <p>Host permission: <span id="confluence-permission-status">Not requested</span></p>
      <button id="grant-confluence-permission" type="button">Grant host permission</button>
      <p id="confluence-settings-status" role="status"></p>
    </section>
  `;

  const elements = getConfluenceOptionsElements(root);
  updateConfluenceOptions(elements, state);
  return elements;
}

export function renderNotionOptions(root: HTMLElement, state: NotionOptionsState): NotionOptionsElements {
  root.innerHTML = `
    <section aria-labelledby="notion-settings-title">
      <h2 id="notion-settings-title">Notion settings</h2>
      <p>Authorization: <span id="notion-authorization-status">Not connected</span></p>
      <button id="connect-notion" type="button">Connect Notion</button>
      <button id="logout-notion" type="button">Logout Notion</button>
      <div>
        <label for="notion-target-search">Search Notion targets</label>
        <input id="notion-target-search" type="search" />
        <button id="search-notion-targets" type="button">Search targets</button>
      </div>
      <p id="selected-notion-target">Selected target: None</p>
      <div id="notion-target-results"></div>
      <p id="notion-target-guidance"></p>
      <p id="notion-settings-status" role="status"></p>
    </section>
  `;

  const elements = getNotionOptionsElements(root);
  updateNotionOptions(elements, state);
  return elements;
}

export function updateConfluenceOptions(elements: ConfluenceOptionsElements, state: ConfluenceOptionsState): void {
  elements.input.value = state.inputValue;
  elements.error.textContent = state.validationMessage ?? '';
  elements.savedUrl.textContent = state.savedBaseUrl ?? 'Not configured';
  elements.permissionStatus.textContent = formatPermissionStatus(state);
  elements.grantButton.disabled = !state.savedBaseUrl;
  elements.status.textContent = state.statusMessage ?? '';
}

export function updateNotionOptions(elements: NotionOptionsElements, state: NotionOptionsState): void {
  elements.authorizationStatus.textContent = formatAuthorizationStatus(state);
  elements.connectButton.disabled = state.connected && !state.requiresReauthorization;
  elements.logoutButton.disabled = !state.connected;
  elements.searchInput.value = state.searchQuery;
  elements.searchButton.disabled = !state.connected;
  elements.selectedTarget.textContent = formatSelectedTarget(state.selectedTarget);
  elements.guidance.textContent = state.guidance ?? '';
  elements.status.textContent = state.statusMessage ?? '';
  renderTargetResults(elements, state.searchResults);
}

export function getValidationMessage(error: ConfluenceBaseUrlValidationError): string {
  return validationMessages[error];
}

export async function mountConfluenceOptions(root: HTMLElement): Promise<void> {
  let state: ConfluenceOptionsState = await loadConfluenceOptionsState();

  const elements = renderConfluenceOptions(root, state);

  elements.form.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveBaseUrl(elements, state, (nextState) => {
      state = nextState;
      updateConfluenceOptions(elements, state);
    });
  });

  elements.grantButton.addEventListener('click', () => {
    void grantPermission(elements, state, (nextState) => {
      state = nextState;
      updateConfluenceOptions(elements, state);
    });
  });
}

export async function mountOptionsPage(root: HTMLElement, dependencies: OptionsPageDependencies = {}): Promise<void> {
  root.innerHTML = `
    <h1>Add to Notion Options</h1>
    <div id="confluence-options-root"></div>
    <div id="notion-options-root"></div>
  `;

  await mountConfluenceOptions(getRequiredElement(root, '#confluence-options-root', HTMLElement));
  await mountNotionOptions(getRequiredElement(root, '#notion-options-root', HTMLElement), dependencies);
}

export async function mountNotionOptions(root: HTMLElement, dependencies: OptionsPageDependencies = {}): Promise<void> {
  let state = await loadNotionOptionsState(dependencies.notion);
  const elements = renderNotionOptions(root, state);

  elements.connectButton.addEventListener('click', () => {
    void connectNotion(dependencies, async (nextState) => {
      state = nextState;
      await refreshNotionOptions(elements, state);
    });
  });

  elements.logoutButton.addEventListener('click', () => {
    void logoutNotionOptions((nextState) => {
      state = nextState;
      updateNotionOptions(elements, state);
    });
  });

  elements.searchButton.addEventListener('click', () => {
    void searchTargets(elements, state, dependencies, (nextState) => {
      state = nextState;
      updateNotionOptions(elements, state);
    });
  });

  elements.results.addEventListener('click', (event) => {
    const button = event.target instanceof HTMLElement ? event.target.closest<HTMLButtonElement>('[data-target-id]') : null;

    if (!button) {
      return;
    }

    const target = state.searchResults.find((candidate) => candidate.id === button.dataset.targetId);

    if (!target) {
      return;
    }

    void selectNotionTarget(target, dependencies, state, (nextState) => {
      state = nextState;
      updateNotionOptions(elements, state);
    });
  });
}

async function loadConfluenceOptionsState(): Promise<ConfluenceOptionsState> {
  let state: ConfluenceOptionsState = {
    inputValue: '',
    savedBaseUrl: await readConfluenceBaseUrl()
  };

  if (state.savedBaseUrl) {
    state = {
      ...state,
      inputValue: state.savedBaseUrl,
      permissionGranted: await hasConfluenceHostPermission(state.savedBaseUrl)
    };
  }

  return state;
}

async function loadNotionOptionsState(options?: NotionAuthOptions): Promise<NotionOptionsState> {
  const [authorizationStatus, selectedTarget] = await Promise.all([
    getNotionAuthorizationStatus(options),
    readLocalStorageValue(storageKeys.notionDefaultTarget)
  ]);

  return {
    connected: authorizationStatus.connected,
    workspaceName: authorizationStatus.workspace?.workspaceName,
    requiresReauthorization: authorizationStatus.requiresReauthorization,
    selectedTarget,
    searchQuery: '',
    searchResults: []
  };
}

async function refreshNotionOptions(elements: NotionOptionsElements, state: NotionOptionsState): Promise<void> {
  updateNotionOptions(elements, state);
}

async function saveBaseUrl(
  elements: ConfluenceOptionsElements,
  state: ConfluenceOptionsState,
  commit: (state: ConfluenceOptionsState) => void
): Promise<void> {
  const inputValue = elements.input.value;
  const validation = normalizeConfluenceBaseUrl(inputValue);

  if (!validation.ok) {
    commit({
      ...state,
      inputValue,
      validationMessage: getValidationMessage(validation.error),
      statusMessage: 'Confluence URL was not saved.'
    });
    return;
  }

  const savedBaseUrl = await saveConfluenceBaseUrl(inputValue);
  const permissionGranted = await requestConfluenceHostPermission(savedBaseUrl);

  commit({
    inputValue: savedBaseUrl,
    savedBaseUrl,
    permissionGranted,
    statusMessage: permissionGranted
      ? 'Confluence URL saved and host permission granted.'
      : 'Confluence URL saved. Grant host permission before saving pages.'
  });
}

async function grantPermission(
  elements: ConfluenceOptionsElements,
  state: ConfluenceOptionsState,
  commit: (state: ConfluenceOptionsState) => void
): Promise<void> {
  if (!state.savedBaseUrl) {
    return;
  }

  const permissionGranted = await requestConfluenceHostPermission(state.savedBaseUrl);

  commit({
    ...state,
    inputValue: elements.input.value,
    permissionGranted,
    statusMessage: permissionGranted ? 'Host permission granted.' : 'Host permission was not granted.'
  });
}

async function connectNotion(
  dependencies: OptionsPageDependencies,
  commit: (state: NotionOptionsState) => Promise<void>
): Promise<void> {
  try {
    await startNotionOAuth(dependencies.notion);
  } catch (error) {
    if (error instanceof Error && error.message === NOTION_OAUTH_CLIENT_ID_CONFIGURATION_ERROR) {
      const state = await loadNotionOptionsState(dependencies.notion);
      await commit({ ...state, statusMessage: NOTION_OAUTH_CLIENT_ID_CONFIGURATION_MESSAGE });
      return;
    }

    throw error;
  }

  const state = await loadNotionOptionsState(dependencies.notion);
  await commit({ ...state, statusMessage: 'Notion connected.' });
}

async function logoutNotionOptions(commit: (state: NotionOptionsState) => void): Promise<void> {
  await logoutNotion();
  commit({
    connected: false,
    requiresReauthorization: false,
    searchQuery: '',
    searchResults: [],
    statusMessage: 'Notion logged out.'
  });
}

async function searchTargets(
  elements: NotionOptionsElements,
  state: NotionOptionsState,
  dependencies: OptionsPageDependencies,
  commit: (state: NotionOptionsState) => void
): Promise<void> {
  const searchQuery = elements.searchInput.value;
  const result = await searchNotionTargets(searchQuery, dependencies.notion);

  commit({
    ...state,
    searchQuery,
    searchResults: result.targets,
    guidance: result.guidance,
    statusMessage: result.targets.length > 0 ? 'Notion targets loaded.' : undefined
  });
}

async function selectNotionTarget(
  target: NotionTarget,
  dependencies: OptionsPageDependencies,
  state: NotionOptionsState,
  commit: (state: NotionOptionsState) => void
): Promise<void> {
  const selectedTarget = await saveNotionTargetSelection(
    target.type === 'database' ? { type: 'database', id: target.id } : target,
    dependencies.notion
  );

  commit({
    ...state,
    selectedTarget,
    statusMessage: 'Default Notion target saved.'
  });
}

function getConfluenceOptionsElements(root: HTMLElement): ConfluenceOptionsElements {
  return {
    root,
    form: getRequiredElement(root, '#confluence-base-url-form', HTMLFormElement),
    input: getRequiredElement(root, '#confluence-base-url', HTMLInputElement),
    error: getRequiredElement(root, '#confluence-base-url-error', HTMLElement),
    savedUrl: getRequiredElement(root, '#saved-confluence-base-url', HTMLElement),
    permissionStatus: getRequiredElement(root, '#confluence-permission-status', HTMLElement),
    grantButton: getRequiredElement(root, '#grant-confluence-permission', HTMLButtonElement),
    status: getRequiredElement(root, '#confluence-settings-status', HTMLElement)
  };
}

function getNotionOptionsElements(root: HTMLElement): NotionOptionsElements {
  return {
    root,
    authorizationStatus: getRequiredElement(root, '#notion-authorization-status', HTMLElement),
    connectButton: getRequiredElement(root, '#connect-notion', HTMLButtonElement),
    logoutButton: getRequiredElement(root, '#logout-notion', HTMLButtonElement),
    searchInput: getRequiredElement(root, '#notion-target-search', HTMLInputElement),
    searchButton: getRequiredElement(root, '#search-notion-targets', HTMLButtonElement),
    selectedTarget: getRequiredElement(root, '#selected-notion-target', HTMLElement),
    results: getRequiredElement(root, '#notion-target-results', HTMLElement),
    guidance: getRequiredElement(root, '#notion-target-guidance', HTMLElement),
    status: getRequiredElement(root, '#notion-settings-status', HTMLElement)
  };
}

function getRequiredElement<ElementType extends HTMLElement>(
  root: HTMLElement,
  selector: string,
  elementType: typeof HTMLElement
): ElementType {
  const element = root.querySelector(selector);

  if (!(element instanceof elementType)) {
    throw new Error(`Missing options element: ${selector}`);
  }

  return element as ElementType;
}

function formatPermissionStatus(state: ConfluenceOptionsState): string {
  if (!state.savedBaseUrl) {
    return 'Not requested';
  }

  return state.permissionGranted ? 'Granted' : 'Missing';
}

function formatAuthorizationStatus(state: NotionOptionsState): string {
  if (!state.connected) {
    return 'Not connected';
  }

  if (state.requiresReauthorization) {
    return 'Reauthorization required';
  }

  return state.workspaceName ? `Connected to ${state.workspaceName}` : 'Connected';
}

function formatSelectedTarget(target?: NotionTarget): string {
  if (!target) {
    return 'Selected target: None';
  }

  return `Selected target: ${target.type === 'database' ? 'Database' : 'Page'} — ${target.displayName}`;
}

function renderTargetResults(elements: NotionOptionsElements, targets: NotionTarget[]): void {
  elements.results.replaceChildren(
    ...targets.map((target) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.targetId = target.id;
      button.textContent = `${target.type === 'database' ? 'Database' : 'Page'} — ${target.displayName}`;
      return button;
    })
  );
}

const app = document.querySelector<HTMLElement>('#app');

if (app) {
  void mountOptionsPage(app);
}
