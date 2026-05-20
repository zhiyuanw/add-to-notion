import type { Degradation } from '../shared/domain';

export interface ConfluenceStorageDocument {
  type: 'document';
  children: ConfluenceStorageNode[];
}

export type ConfluenceStorageNode = ConfluenceStorageElement | ConfluenceStorageText;

export interface ConfluenceStorageElement {
  type: 'element';
  name: string;
  localName: string;
  namespacePrefix?: string;
  attributes: ConfluenceStorageAttribute[];
  children: ConfluenceStorageNode[];
}

export interface ConfluenceStorageAttribute {
  name: string;
  localName: string;
  namespacePrefix?: string;
  value: string;
}

export interface ConfluenceStorageText {
  type: 'text';
  text: string;
}

export type ConfluenceStorageParseResult =
  | { ok: true; document: ConfluenceStorageDocument; degradations: Degradation[] }
  | { ok: false; reason: 'parse-error'; message: string };

interface MutableElement extends ConfluenceStorageElement {
  children: ConfluenceStorageNode[];
}

const unsupportedRawHtmlElements = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'button',
  'input',
  'form',
  'textarea',
  'select',
  'option',
  'svg',
  'math',
  'canvas'
]);

export function parseConfluenceStorageXml(storageXml: string): ConfluenceStorageParseResult {
  const degradations: Degradation[] = [];
  const root: MutableElement = createElement('__document__', []);
  const stack: MutableElement[] = [root];
  let index = 0;

  try {
    while (index < storageXml.length) {
      if (storageXml.startsWith('<!--', index)) {
        index = readUntil(storageXml, '-->', index + 4);
        continue;
      }

      if (storageXml.startsWith('<![CDATA[', index)) {
        const end = storageXml.indexOf(']]>', index + 9);
        if (end === -1) {
          return parseError('Unclosed CDATA section.');
        }
        appendText(stack, storageXml.slice(index + 9, end));
        index = end + 3;
        continue;
      }

      if (storageXml.startsWith('<!DOCTYPE', index) || storageXml.startsWith('<!doctype', index)) {
        const nextIndex = skipDoctype(storageXml, index);
        if (nextIndex === -1) {
          return parseError('Malformed DOCTYPE declaration.');
        }
        degradations.push(blockedExternalEntityDegradation());
        index = nextIndex;
        continue;
      }

      if (storageXml.startsWith('<!ENTITY', index) || storageXml.startsWith('<!entity', index)) {
        index = readUntil(storageXml, '>', index + 8);
        degradations.push(blockedExternalEntityDegradation());
        continue;
      }

      if (storageXml.startsWith('<?', index)) {
        index = readUntil(storageXml, '?>', index + 2);
        continue;
      }

      if (storageXml[index] !== '<') {
        const nextTag = storageXml.indexOf('<', index);
        const end = nextTag === -1 ? storageXml.length : nextTag;
        appendText(stack, decodeXmlText(storageXml.slice(index, end)));
        index = end;
        continue;
      }

      if (storageXml.startsWith('</', index)) {
        const close = storageXml.indexOf('>', index + 2);
        if (close === -1) {
          return parseError('Unclosed closing tag.');
        }

        const closingName = storageXml.slice(index + 2, close).trim();
        const current = stack.at(-1);
        if (!current || stack.length === 1 || current.name !== closingName) {
          return parseError(`Unexpected closing tag ${closingName}.`);
        }

        stack.pop();
        index = close + 1;
        continue;
      }

      const parsedTag = parseOpeningTag(storageXml, index);
      if (!parsedTag.ok) {
        return parseError(parsedTag.message);
      }

      const element = createElement(parsedTag.name, parsedTag.attributes);
      stack.at(-1)?.children.push(element);
      if (!parsedTag.selfClosing) {
        stack.push(element);
      }
      index = parsedTag.nextIndex;
    }
  } catch (error) {
    return parseError(error instanceof Error ? error.message : 'Unknown XML parse failure.');
  }

  if (stack.length !== 1) {
    return parseError(`Unclosed tag ${stack.at(-1)?.name ?? ''}.`);
  }

  const sanitized = sanitizeNodes(root.children, degradations);

  return {
    ok: true,
    document: {
      type: 'document',
      children: sanitized
    },
    degradations: uniqueDegradations(degradations)
  };
}

function parseOpeningTag(
  source: string,
  start: number
):
  | { ok: true; name: string; attributes: ConfluenceStorageAttribute[]; selfClosing: boolean; nextIndex: number }
  | { ok: false; message: string } {
  const close = findTagClose(source, start + 1);
  if (close === -1) {
    return { ok: false, message: 'Unclosed opening tag.' };
  }

  let content = source.slice(start + 1, close).trim();
  const selfClosing = content.endsWith('/');
  if (selfClosing) {
    content = content.slice(0, -1).trimEnd();
  }

  const nameMatch = /^([^\s/>]+)/.exec(content);
  if (!nameMatch) {
    return { ok: false, message: 'Opening tag is missing an element name.' };
  }

  const name = nameMatch[1];
  const attributesSource = content.slice(name.length);
  const parsedAttributes = parseAttributes(attributesSource);
  if (!parsedAttributes.ok) {
    return parsedAttributes;
  }

  return {
    ok: true,
    name,
    attributes: parsedAttributes.attributes,
    selfClosing,
    nextIndex: close + 1
  };
}

function parseAttributes(
  source: string
): { ok: true; attributes: ConfluenceStorageAttribute[] } | { ok: false; message: string } {
  const attributes: ConfluenceStorageAttribute[] = [];
  let index = 0;

  while (index < source.length) {
    while (/\s/.test(source[index] ?? '')) {
      index += 1;
    }
    if (index >= source.length) {
      break;
    }

    const nameStart = index;
    while (index < source.length && !/[\s=]/.test(source[index])) {
      index += 1;
    }
    const name = source.slice(nameStart, index);
    if (!name) {
      return { ok: false, message: 'Malformed attribute name.' };
    }

    while (/\s/.test(source[index] ?? '')) {
      index += 1;
    }
    if (source[index] !== '=') {
      return { ok: false, message: `Attribute ${name} is missing a value.` };
    }
    index += 1;
    while (/\s/.test(source[index] ?? '')) {
      index += 1;
    }

    const quote = source[index];
    if (quote !== '"' && quote !== "'") {
      return { ok: false, message: `Attribute ${name} value must be quoted.` };
    }
    index += 1;
    const valueStart = index;
    while (index < source.length && source[index] !== quote) {
      index += 1;
    }
    if (index >= source.length) {
      return { ok: false, message: `Attribute ${name} value is unclosed.` };
    }

    attributes.push(createAttribute(name, decodeXmlText(source.slice(valueStart, index))));
    index += 1;
  }

  return { ok: true, attributes };
}

function sanitizeNodes(nodes: ConfluenceStorageNode[], degradations: Degradation[]): ConfluenceStorageNode[] {
  const sanitized: ConfluenceStorageNode[] = [];

  for (const node of nodes) {
    if (node.type === 'text') {
      if (node.text.length > 0) {
        sanitized.push(node);
      }
      continue;
    }

    const sanitizedChildren = sanitizeNodes(node.children, degradations);
    if (!node.namespacePrefix && unsupportedRawHtmlElements.has(node.localName.toLowerCase())) {
      degradations.push({
        type: 'unsupported-raw-html',
        source: node.name,
        message: `Converted unsupported raw HTML element ${node.name} to plain text.`,
        severity: 'warning'
      });

      const text = collectText(sanitizedChildren);
      if (text.length > 0) {
        sanitized.push({ type: 'text', text });
      }
      continue;
    }

    sanitized.push({
      ...node,
      attributes: sanitizeAttributes(node, degradations),
      children: sanitizedChildren
    });
  }

  return sanitized;
}

function sanitizeAttributes(element: ConfluenceStorageElement, degradations: Degradation[]): ConfluenceStorageAttribute[] {
  return element.attributes.filter((attribute) => {
    const localName = attribute.localName.toLowerCase();
    const value = attribute.value.trim().toLowerCase();
    const executable = localName.startsWith('on') || value.startsWith('javascript:') || localName === 'srcdoc';
    if (executable) {
      degradations.push({
        type: 'unsupported-raw-html',
        source: `${element.name}@${attribute.name}`,
        message: `Removed executable raw HTML attribute ${attribute.name}.`,
        severity: 'warning'
      });
      return false;
    }
    return true;
  });
}

function createElement(name: string, attributes: ConfluenceStorageAttribute[]): MutableElement {
  return {
    type: 'element',
    name,
    ...splitQualifiedName(name),
    attributes,
    children: []
  };
}

function createAttribute(name: string, value: string): ConfluenceStorageAttribute {
  return {
    name,
    ...splitQualifiedName(name),
    value
  };
}

function splitQualifiedName(name: string): { localName: string; namespacePrefix?: string } {
  const colon = name.indexOf(':');
  if (colon === -1) {
    return { localName: name };
  }

  return {
    namespacePrefix: name.slice(0, colon),
    localName: name.slice(colon + 1)
  };
}

function appendText(stack: MutableElement[], text: string): void {
  if (text.length === 0) {
    return;
  }
  stack.at(-1)?.children.push({ type: 'text', text });
}

function decodeXmlText(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos|[A-Za-z][\w.-]*);/g, (entity, body: string) => {
    if (body === 'amp') return '&';
    if (body === 'lt') return '<';
    if (body === 'gt') return '>';
    if (body === 'quot') return '"';
    if (body === 'apos') return "'";
    if (body.startsWith('#x')) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return '';
  });
}

function collectText(nodes: ConfluenceStorageNode[]): string {
  return nodes
    .map((node) => (node.type === 'text' ? node.text : collectText(node.children)))
    .join('');
}

function skipDoctype(source: string, start: number): number {
  const firstClose = source.indexOf('>', start + 9);
  const subsetOpen = source.indexOf('[', start + 9);
  if (subsetOpen !== -1 && (firstClose === -1 || subsetOpen < firstClose)) {
    const subsetClose = source.indexOf(']>', subsetOpen + 1);
    return subsetClose === -1 ? -1 : subsetClose + 2;
  }
  return firstClose === -1 ? -1 : firstClose + 1;
}

function readUntil(source: string, marker: string, start: number): number {
  const end = source.indexOf(marker, start);
  if (end === -1) {
    throw new Error(`Missing ${marker}.`);
  }
  return end + marker.length;
}

function findTagClose(source: string, start: number): number {
  let quote: string | undefined;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '>') {
      return index;
    }
  }
  return -1;
}

function blockedExternalEntityDegradation(): Degradation {
  return {
    type: 'external-entity-blocked',
    source: 'storage-xml',
    message: 'Blocked external entity declarations in Confluence storage XML.',
    severity: 'warning'
  };
}

function uniqueDegradations(degradations: Degradation[]): Degradation[] {
  const seen = new Set<string>();
  return degradations.filter((degradation) => {
    const key = `${degradation.type}:${degradation.source}:${degradation.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function parseError(detail: string): ConfluenceStorageParseResult {
  return {
    ok: false,
    reason: 'parse-error',
    message: `Malformed Confluence storage XML: ${detail}`
  };
}
