import { describe, expect, it } from 'vitest';

import { convertConfluenceStorageToNotionBlocks } from '../converter';
import { parseConfluenceStorageXml } from '../confluence';

const simpleFixture = `
<h1>Project Plan</h1>
<p>Hello <strong>bold</strong> <em>italic</em> <s>strike</s> <code>inline</code> <span style="color: rgb(255,0,0);">red</span> <a href="https://example.com/doc">link</a>.</p>
<ul>
  <li>First bullet<ul><li>Nested bullet</li></ul></li>
  <li>Second bullet</li>
</ul>
<ol>
  <li>First number<ol><li>Nested number</li></ol></li>
</ol>
<table>
  <tbody>
    <tr><th>Name</th><th>Status</th></tr>
    <tr><td>Alpha</td><td><strong>Ready</strong></td></tr>
  </tbody>
</table>
`;

describe('Confluence basic content converter', () => {
  it('converts the simple fixture directly to Notion blocks', () => {
    const parsed = parseConfluenceStorageXml(simpleFixture);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = convertConfluenceStorageToNotionBlocks(parsed.document);

    expect(result.degradations).toEqual([]);
    expect(result.blocks).toEqual([
      {
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [{ type: 'text', text: { content: 'Project Plan' }, annotations: {} }]
        }
      },
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            { type: 'text', text: { content: 'Hello ' }, annotations: {} },
            { type: 'text', text: { content: 'bold' }, annotations: { bold: true } },
            { type: 'text', text: { content: ' ' }, annotations: {} },
            { type: 'text', text: { content: 'italic' }, annotations: { italic: true } },
            { type: 'text', text: { content: ' ' }, annotations: {} },
            { type: 'text', text: { content: 'strike' }, annotations: { strikethrough: true } },
            { type: 'text', text: { content: ' ' }, annotations: {} },
            { type: 'text', text: { content: 'inline' }, annotations: { code: true } },
            { type: 'text', text: { content: ' ' }, annotations: {} },
            { type: 'text', text: { content: 'red' }, annotations: { color: 'red' } },
            { type: 'text', text: { content: ' ' }, annotations: {} },
            { type: 'text', text: { content: 'link', link: { url: 'https://example.com/doc' } }, annotations: {} },
            { type: 'text', text: { content: '.' }, annotations: {} }
          ]
        }
      },
      {
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{ type: 'text', text: { content: 'First bullet' }, annotations: {} }],
          children: [
            {
              object: 'block',
              type: 'bulleted_list_item',
              bulleted_list_item: {
                rich_text: [{ type: 'text', text: { content: 'Nested bullet' }, annotations: {} }]
              }
            }
          ]
        }
      },
      {
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{ type: 'text', text: { content: 'Second bullet' }, annotations: {} }]
        }
      },
      {
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: [{ type: 'text', text: { content: 'First number' }, annotations: {} }],
          children: [
            {
              object: 'block',
              type: 'numbered_list_item',
              numbered_list_item: {
                rich_text: [{ type: 'text', text: { content: 'Nested number' }, annotations: {} }]
              }
            }
          ]
        }
      },
      {
        object: 'block',
        type: 'table',
        table: {
          table_width: 2,
          has_column_header: true,
          has_row_header: false,
          children: [
            {
              object: 'block',
              type: 'table_row',
              table_row: {
                cells: [
                  [{ type: 'text', text: { content: 'Name' }, annotations: {} }],
                  [{ type: 'text', text: { content: 'Status' }, annotations: {} }]
                ]
              }
            },
            {
              object: 'block',
              type: 'table_row',
              table_row: {
                cells: [
                  [{ type: 'text', text: { content: 'Alpha' }, annotations: {} }],
                  [{ type: 'text', text: { content: 'Ready' }, annotations: { bold: true } }]
                ]
              }
            }
          ]
        }
      }
    ]);
  });

  it('flattens complex tables to paragraphs with a degradation', () => {
    const parsed = parseConfluenceStorageXml('<table><tr><td colspan="2">Merged</td></tr></table>');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = convertConfluenceStorageToNotionBlocks(parsed.document);

    expect(result.blocks).toEqual([
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: 'Merged' }, annotations: {} }]
        }
      }
    ]);
    expect(result.degradations).toEqual([
      {
        type: 'complex-table-flattened',
        source: 'table',
        message: 'Flattened a complex Confluence table to plain text.',
        severity: 'warning'
      }
    ]);
  });
});
