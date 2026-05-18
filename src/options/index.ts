import {
  hasConfluenceHostPermission,
  normalizeConfluenceBaseUrl,
  requestConfluenceHostPermission,
  type ConfluenceBaseUrlValidationError
} from '../confluence';
import { readConfluenceBaseUrl, saveConfluenceBaseUrl } from '../shared/storage';

type ConfluenceOptionsState = {
  inputValue: string;
  savedBaseUrl?: string;
  validationMessage?: string;
  permissionGranted?: boolean;
  statusMessage?: string;
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

export function updateConfluenceOptions(elements: ConfluenceOptionsElements, state: ConfluenceOptionsState): void {
  elements.input.value = state.inputValue;
  elements.error.textContent = state.validationMessage ?? '';
  elements.savedUrl.textContent = state.savedBaseUrl ?? 'Not configured';
  elements.permissionStatus.textContent = formatPermissionStatus(state);
  elements.grantButton.disabled = !state.savedBaseUrl;
  elements.status.textContent = state.statusMessage ?? '';
}

export function getValidationMessage(error: ConfluenceBaseUrlValidationError): string {
  return validationMessages[error];
}

export async function mountConfluenceOptions(root: HTMLElement): Promise<void> {
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

const app = document.querySelector<HTMLElement>('#app');

if (app) {
  void mountConfluenceOptions(app);
}
