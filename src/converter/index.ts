import type { ConfluenceStorageDocument, ConfluenceStorageElement, ConfluenceStorageNode } from '../confluence/storageParser';
import type { Degradation } from '../shared/domain';

export interface NotionTextRichText {
  type: 'text';
  text: {
    content: string;
    link?: {
      url: string;
    };
  };
  annotations: NotionTextAnnotations;
}

export interface NotionTextAnnotations {
  bold?: true;
  italic?: true;
  strikethrough?: true;
  code?: true;
  color?: string;
}

export type NotionRichText = NotionTextRichText;

export type NotionBlock =
  | NotionParagraphBlock
  | NotionHeadingBlock
  | NotionBulletedListItemBlock
  | NotionNumberedListItemBlock
  | NotionTableBlock
  | NotionTableRowBlock
  | NotionCodeBlock
  | NotionCalloutBlock
  | NotionToggleBlock;

export interface NotionParagraphBlock {
  object: 'block';
  type: 'paragraph';
  paragraph: {
    rich_text: NotionRichText[];
  };
}

export interface NotionHeadingBlock {
  object: 'block';
  type: 'heading_1' | 'heading_2' | 'heading_3';
  heading_1?: { rich_text: NotionRichText[] };
  heading_2?: { rich_text: NotionRichText[] };
  heading_3?: { rich_text: NotionRichText[] };
}

export interface NotionBulletedListItemBlock {
  object: 'block';
  type: 'bulleted_list_item';
  bulleted_list_item: {
    rich_text: NotionRichText[];
    children?: NotionBlock[];
  };
}

export interface NotionNumberedListItemBlock {
  object: 'block';
  type: 'numbered_list_item';
  numbered_list_item: {
    rich_text: NotionRichText[];
    children?: NotionBlock[];
  };
}

export interface NotionTableBlock {
  object: 'block';
  type: 'table';
  table: {
    table_width: number;
    has_column_header: boolean;
    has_row_header: false;
    children: NotionTableRowBlock[];
  };
}

export interface NotionTableRowBlock {
  object: 'block';
  type: 'table_row';
  table_row: {
    cells: NotionRichText[][];
  };
}

export interface NotionCodeBlock {
  object: 'block';
  type: 'code';
  code: {
    rich_text: NotionRichText[];
    language: string;
  };
}

export interface NotionCalloutBlock {
  object: 'block';
  type: 'callout';
  callout: {
    rich_text: NotionRichText[];
    children?: NotionBlock[];
  };
}

export interface NotionToggleBlock {
  object: 'block';
  type: 'toggle';
  toggle: {
    rich_text: NotionRichText[];
    children?: NotionBlock[];
  };
}

export interface ConfluenceToNotionConversionOptions {
  acceptedCodeLanguages?: ReadonlySet<string>;
}

export const defaultAcceptedCodeLanguages = new Set([
  'plain text',
  'mermaid',
  'typescript',
  'javascript',
  'java',
  'python',
  'go',
  'rust',
  'sql',
  'bash',
  'shell',
  'json',
  'xml',
  'html',
  'css',
  'markdown',
  'yaml'
]);

export interface ConfluenceToNotionConversionResult {
  blocks: NotionBlock[];
  degradations: Degradation[];
}

interface InlineContext {
  annotations: NotionTextAnnotations;
  link?: string;
}

export function convertConfluenceStorageToNotionBlocks(
  document: ConfluenceStorageDocument,
  options: ConfluenceToNotionConversionOptions = {}
): ConfluenceToNotionConversionResult {
  const degradations: Degradation[] = [];
  const acceptedCodeLanguages = options.acceptedCodeLanguages ?? defaultAcceptedCodeLanguages;
  return {
    blocks: convertBlockNodes(document.children, degradations, acceptedCodeLanguages),
    degradations
  };
}

function convertBlockNodes(
  nodes: ConfluenceStorageNode[],
  degradations: Degradation[],
  acceptedCodeLanguages: ReadonlySet<string>
): NotionBlock[] {
  const blocks: NotionBlock[] = [];
  let textBuffer: ConfluenceStorageNode[] = [];

  for (const node of nodes) {
    if (node.type === 'text') {
      if (node.text.trim().length > 0) {
        textBuffer.push(node);
      }
      continue;
    }

    if (isInlineElement(node)) {
      textBuffer.push(node);
      continue;
    }

    blocks.push(...flushParagraph(textBuffer));
    textBuffer = [];

    if (isMacro(node)) {
      blocks.push(convertMacro(node, degradations, acceptedCodeLanguages));
      continue;
    }

    if (isHeading(node)) {
      blocks.push(createHeadingBlock(node));
      continue;
    }

    if (node.localName === 'p') {
      blocks.push(...flushParagraph(node.children));
      continue;
    }

    if (node.localName === 'ul' || node.localName === 'ol') {
      blocks.push(...convertList(node, degradations, acceptedCodeLanguages));
      continue;
    }

    if (node.localName === 'table') {
      blocks.push(convertTable(node, degradations));
      continue;
    }

    blocks.push(...convertBlockNodes(node.children, degradations, acceptedCodeLanguages));
  }

  blocks.push(...flushParagraph(textBuffer));
  return blocks;
}

function flushParagraph(nodes: ConfluenceStorageNode[]): NotionParagraphBlock[] {
  if (nodes.length === 0) {
    return [];
  }

  const richText = normalizeRichText(convertInlineNodes(nodes, { annotations: {} }));
  if (plainText(richText).trim().length === 0) {
    return [];
  }

  return [
    {
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: richText }
    }
  ];
}

function createHeadingBlock(node: ConfluenceStorageElement): NotionHeadingBlock {
  const level = Math.min(Number(node.localName.slice(1)), 3) as 1 | 2 | 3;
  const type = `heading_${level}` as 'heading_1' | 'heading_2' | 'heading_3';
  return {
    object: 'block',
    type,
    [type]: {
      rich_text: normalizeRichText(convertInlineNodes(node.children, { annotations: {} }))
    }
  };
}

function convertList(
  node: ConfluenceStorageElement,
  degradations: Degradation[],
  acceptedCodeLanguages: ReadonlySet<string>
): NotionBlock[] {
  return elementChildren(node)
    .filter((child) => child.localName === 'li')
    .map((item) =>
      convertListItem(item, node.localName === 'ol' ? 'numbered_list_item' : 'bulleted_list_item', degradations, acceptedCodeLanguages)
    );
}

function convertListItem(
  item: ConfluenceStorageElement,
  type: 'bulleted_list_item' | 'numbered_list_item',
  degradations: Degradation[],
  acceptedCodeLanguages: ReadonlySet<string>
): NotionBulletedListItemBlock | NotionNumberedListItemBlock {
  const inlineChildren: ConfluenceStorageNode[] = [];
  const nestedBlocks: NotionBlock[] = [];

  for (const child of item.children) {
    if (child.type === 'element' && (child.localName === 'ul' || child.localName === 'ol')) {
      nestedBlocks.push(...convertList(child, degradations, acceptedCodeLanguages));
      continue;
    }
    inlineChildren.push(child);
  }

  const listPayload = {
    rich_text: normalizeRichText(convertInlineNodes(inlineChildren, { annotations: {} })),
    ...(nestedBlocks.length > 0 ? { children: nestedBlocks } : {})
  };

  if (type === 'bulleted_list_item') {
    return {
      object: 'block',
      type,
      bulleted_list_item: listPayload
    };
  }

  return {
    object: 'block',
    type,
    numbered_list_item: listPayload
  };
}

function convertMacro(
  node: ConfluenceStorageElement,
  degradations: Degradation[],
  acceptedCodeLanguages: ReadonlySet<string>
): NotionBlock {
  const macroName = macroNameFor(node);

  if (macroName === 'mermaid') {
    return createCodeBlock(plainTextBody(node), codeLanguageOrFallback('mermaid', macroName, degradations, acceptedCodeLanguages));
  }

  if (macroName === 'code' || macroName === 'noformat') {
    const requestedLanguage = macroName === 'code' ? macroParameter(node, 'language') : undefined;
    const language = requestedLanguage ? normalizeCodeLanguage(requestedLanguage) : 'plain text';
    return createCodeBlock(plainTextBody(node), codeLanguageOrFallback(language, macroName, degradations, acceptedCodeLanguages));
  }

  if (new Set(['info', 'note', 'tip', 'warning']).has(macroName)) {
    return createCalloutBlock(richTextBodyRichText(node));
  }

  if (macroName === 'expand') {
    const children = convertBlockNodes(richTextBodyChildren(node), degradations, acceptedCodeLanguages);
    return {
      object: 'block',
      type: 'toggle',
      toggle: {
        rich_text: [createTextRichText(macroParameter(node, 'title') ?? 'Details', { annotations: {} })],
        ...(children.length > 0 ? { children } : {})
      }
    };
  }

  const children = convertBlockNodes(richTextBodyChildren(node), degradations, acceptedCodeLanguages);
  return createCalloutBlock([createTextRichText(`Unsupported Confluence macro: ${macroName}`, { annotations: {} })], children);
}

function createCodeBlock(content: string, language: string): NotionCodeBlock {
  return {
    object: 'block',
    type: 'code',
    code: {
      rich_text: [createTextRichText(content.trim(), { annotations: {} })],
      language
    }
  };
}

function createCalloutBlock(richText: NotionRichText[], children: NotionBlock[] = []): NotionCalloutBlock {
  return {
    object: 'block',
    type: 'callout',
    callout: {
      rich_text: richText,
      ...(children.length > 0 ? { children } : {})
    }
  };
}

function codeLanguageOrFallback(
  language: string,
  macroName: string,
  degradations: Degradation[],
  acceptedCodeLanguages: ReadonlySet<string>
): string {
  if (acceptedCodeLanguages.has(language)) {
    return language;
  }

  degradations.push({
    type: 'macro-language-fallback',
    source: macroName,
    message: `Converted ${macroName === 'mermaid' ? 'Mermaid' : macroName} macro to plain-text code because Notion language ${language} is not accepted.`,
    severity: 'warning'
  });
  return 'plain text';
}

function macroNameFor(node: ConfluenceStorageElement): string {
  return attributeValue(node, 'name')?.trim() ?? 'unknown';
}

function macroParameter(node: ConfluenceStorageElement, name: string): string | undefined {
  return elementChildren(node)
    .find((child) => child.localName === 'parameter' && attributeValue(child, 'name') === name)
    ?.children.map((child) => (child.type === 'text' ? child.text : collectPlainText(child.children)))
    .join('')
    .trim();
}

function plainTextBody(node: ConfluenceStorageElement): string {
  const body = elementChildren(node).find((child) => child.localName === 'plain-text-body');
  return body ? collectPlainText(body.children) : collectPlainText(richTextBodyChildren(node));
}

function richTextBodyChildren(node: ConfluenceStorageElement): ConfluenceStorageNode[] {
  return elementChildren(node).find((child) => child.localName === 'rich-text-body')?.children ?? [];
}

function richTextBodyRichText(node: ConfluenceStorageElement): NotionRichText[] {
  const children = richTextBodyChildren(node);
  const paragraph = children.length === 1 && children[0]?.type === 'element' && children[0].localName === 'p' ? children[0].children : children;
  return normalizeRichText(convertInlineNodes(paragraph, { annotations: {} }));
}

function normalizeCodeLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  if (normalized === 'ts') return 'typescript';
  if (normalized === 'js') return 'javascript';
  if (normalized === 'sh') return 'shell';
  return normalized || 'plain text';
}

function convertTable(node: ConfluenceStorageElement, degradations: Degradation[]): NotionBlock {
  const rows = collectTableRows(node);
  const complex = rows.some((row) =>
    elementChildren(row).some((cell) => hasAttribute(cell, 'rowspan') || hasAttribute(cell, 'colspan'))
  );

  if (complex || rows.length === 0) {
    degradations.push({
      type: 'complex-table-flattened',
      source: 'table',
      message: 'Flattened a complex Confluence table to plain text.',
      severity: 'warning'
    });
    return {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [createTextRichText(collectPlainText(node.children).trim(), { annotations: {} })]
      }
    };
  }

  const tableRows = rows.map((row) => {
    const cells = elementChildren(row)
      .filter((cell) => cell.localName === 'td' || cell.localName === 'th')
      .map((cell) => normalizeRichText(convertInlineNodes(cell.children, { annotations: {} })));
    return {
      object: 'block' as const,
      type: 'table_row' as const,
      table_row: { cells }
    };
  });

  const tableWidth = Math.max(...tableRows.map((row) => row.table_row.cells.length));
  return {
    object: 'block',
    type: 'table',
    table: {
      table_width: tableWidth,
      has_column_header: rows[0] ? elementChildren(rows[0]).some((cell) => cell.localName === 'th') : false,
      has_row_header: false,
      children: tableRows.map((row) => ({
        ...row,
        table_row: {
          cells: padCells(row.table_row.cells, tableWidth)
        }
      }))
    }
  };
}

function convertInlineNodes(nodes: ConfluenceStorageNode[], context: InlineContext): NotionRichText[] {
  return nodes.flatMap((node) => convertInlineNode(node, context));
}

function convertInlineNode(node: ConfluenceStorageNode, context: InlineContext): NotionRichText[] {
  if (node.type === 'text') {
    return node.text.length > 0 ? [createTextRichText(node.text, context)] : [];
  }

  const nextContext = contextForElement(node, context);

  if (node.localName === 'br') {
    return [createTextRichText('\n', context)];
  }

  if (node.localName === 'ul' || node.localName === 'ol') {
    return [createTextRichText(listText(node), context)];
  }

  return convertInlineNodes(node.children, nextContext);
}

function contextForElement(element: ConfluenceStorageElement, context: InlineContext): InlineContext {
  const annotations = { ...context.annotations };

  if (element.localName === 'strong' || element.localName === 'b') {
    annotations.bold = true;
  }
  if (element.localName === 'em' || element.localName === 'i') {
    annotations.italic = true;
  }
  if (element.localName === 's' || element.localName === 'strike' || element.localName === 'del') {
    annotations.strikethrough = true;
  }
  if (element.localName === 'code') {
    annotations.code = true;
  }
  const color = extractColor(element);
  if (color) {
    annotations.color = color;
  }

  return {
    annotations,
    link: element.localName === 'a' ? attributeValue(element, 'href') : context.link
  };
}

function createTextRichText(content: string, context: InlineContext): NotionTextRichText {
  return {
    type: 'text',
    text: {
      content,
      ...(context.link ? { link: { url: context.link } } : {})
    },
    annotations: context.annotations
  };
}

function normalizeRichText(richText: NotionRichText[]): NotionRichText[] {
  return richText.filter((item) => item.text.content.length > 0).map((item) => ({ ...item, annotations: cleanAnnotations(item.annotations) }));
}

function cleanAnnotations(annotations: NotionTextAnnotations): NotionTextAnnotations {
  const clean: NotionTextAnnotations = {};
  if (annotations.bold) clean.bold = true;
  if (annotations.italic) clean.italic = true;
  if (annotations.strikethrough) clean.strikethrough = true;
  if (annotations.code) clean.code = true;
  if (annotations.color) clean.color = annotations.color;
  return clean;
}

function isMacro(node: ConfluenceStorageElement): boolean {
  return node.namespacePrefix === 'ac' && node.localName === 'structured-macro';
}

function isHeading(node: ConfluenceStorageElement): boolean {
  return /^h[1-6]$/.test(node.localName);
}

function isInlineElement(node: ConfluenceStorageElement): boolean {
  return new Set(['a', 'strong', 'b', 'em', 'i', 's', 'strike', 'del', 'code', 'span', 'br']).has(node.localName);
}

function elementChildren(node: ConfluenceStorageElement): ConfluenceStorageElement[] {
  return node.children.filter((child): child is ConfluenceStorageElement => child.type === 'element');
}

function collectTableRows(node: ConfluenceStorageElement): ConfluenceStorageElement[] {
  if (node.localName === 'tr') {
    return [node];
  }
  return elementChildren(node).flatMap(collectTableRows);
}

function collectPlainText(nodes: ConfluenceStorageNode[]): string {
  return nodes.map((node) => (node.type === 'text' ? node.text : collectPlainText(node.children))).join('');
}

function plainText(richText: NotionRichText[]): string {
  return richText.map((item) => item.text.content).join('');
}

function listText(list: ConfluenceStorageElement): string {
  return elementChildren(list)
    .filter((child) => child.localName === 'li')
    .map((item) => collectPlainText(item.children).trim())
    .filter(Boolean)
    .join('\n');
}

function padCells(cells: NotionRichText[][], tableWidth: number): NotionRichText[][] {
  return [...cells, ...Array.from({ length: tableWidth - cells.length }, () => [])];
}

function hasAttribute(element: ConfluenceStorageElement, localName: string): boolean {
  return element.attributes.some((attribute) => attribute.localName === localName);
}

function attributeValue(element: ConfluenceStorageElement, localName: string): string | undefined {
  return element.attributes.find((attribute) => attribute.localName === localName)?.value;
}

function extractColor(element: ConfluenceStorageElement): string | undefined {
  const style = attributeValue(element, 'style')?.toLowerCase();
  if (!style?.includes('color')) {
    return undefined;
  }
  if (style.includes('255,0,0') || style.includes('255, 0, 0') || style.includes('red')) {
    return 'red';
  }
  if (style.includes('0,128,0') || style.includes('0, 128, 0') || style.includes('green')) {
    return 'green';
  }
  if (style.includes('0,0,255') || style.includes('0, 0, 255') || style.includes('blue')) {
    return 'blue';
  }
  if (style.includes('yellow')) {
    return 'yellow';
  }
  return undefined;
}
