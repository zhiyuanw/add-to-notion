import { describe, expect, it } from 'vitest';

import { convertConfluenceStorageToNotionBlocks } from '../converter';
import { parseConfluenceStorageXml } from '../confluence';

const macroHeavyFixture = `
<ac:structured-macro ac:name="mermaid">
  <ac:plain-text-body><![CDATA[graph TD;
A-->B;]]></ac:plain-text-body>
</ac:structured-macro>
<ac:structured-macro ac:name="code">
  <ac:parameter ac:name="language">typescript</ac:parameter>
  <ac:plain-text-body><![CDATA[const answer: number = 42;]]></ac:plain-text-body>
</ac:structured-macro>
<ac:structured-macro ac:name="noformat">
  <ac:plain-text-body><![CDATA[plain preformatted text]]></ac:plain-text-body>
</ac:structured-macro>
<ac:structured-macro ac:name="info">
  <ac:rich-text-body><p>Info <strong>body</strong></p></ac:rich-text-body>
</ac:structured-macro>
<ac:structured-macro ac:name="note">
  <ac:rich-text-body><p>Note body</p></ac:rich-text-body>
</ac:structured-macro>
<ac:structured-macro ac:name="tip">
  <ac:rich-text-body><p>Tip body</p></ac:rich-text-body>
</ac:structured-macro>
<ac:structured-macro ac:name="warning">
  <ac:rich-text-body><p>Warning body</p></ac:rich-text-body>
</ac:structured-macro>
<ac:structured-macro ac:name="expand">
  <ac:parameter ac:name="title">More details</ac:parameter>
  <ac:rich-text-body><p>Nested <em>content</em></p></ac:rich-text-body>
</ac:structured-macro>
<ac:structured-macro ac:name="custom-macro">
  <ac:parameter ac:name="secret">do not include</ac:parameter>
  <ac:rich-text-body><p>Recoverable body</p></ac:rich-text-body>
</ac:structured-macro>
`;

describe('Confluence macro converter', () => {
  it('converts the macro-heavy fixture to Notion-native blocks', () => {
    const parsed = parseConfluenceStorageXml(macroHeavyFixture);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = convertConfluenceStorageToNotionBlocks(parsed.document);

    expect(result.degradations).toEqual([]);
    expect(result.blocks).toEqual([
      {
        object: 'block',
        type: 'code',
        code: {
          rich_text: [{ type: 'text', text: { content: 'graph TD;\nA-->B;' }, annotations: {} }],
          language: 'mermaid'
        }
      },
      {
        object: 'block',
        type: 'code',
        code: {
          rich_text: [{ type: 'text', text: { content: 'const answer: number = 42;' }, annotations: {} }],
          language: 'typescript'
        }
      },
      {
        object: 'block',
        type: 'code',
        code: {
          rich_text: [{ type: 'text', text: { content: 'plain preformatted text' }, annotations: {} }],
          language: 'plain text'
        }
      },
      {
        object: 'block',
        type: 'callout',
        callout: {
          rich_text: [
            { type: 'text', text: { content: 'Info ' }, annotations: {} },
            { type: 'text', text: { content: 'body' }, annotations: { bold: true } }
          ]
        }
      },
      {
        object: 'block',
        type: 'callout',
        callout: {
          rich_text: [{ type: 'text', text: { content: 'Note body' }, annotations: {} }]
        }
      },
      {
        object: 'block',
        type: 'callout',
        callout: {
          rich_text: [{ type: 'text', text: { content: 'Tip body' }, annotations: {} }]
        }
      },
      {
        object: 'block',
        type: 'callout',
        callout: {
          rich_text: [{ type: 'text', text: { content: 'Warning body' }, annotations: {} }]
        }
      },
      {
        object: 'block',
        type: 'toggle',
        toggle: {
          rich_text: [{ type: 'text', text: { content: 'More details' }, annotations: {} }],
          children: [
            {
              object: 'block',
              type: 'paragraph',
              paragraph: {
                rich_text: [
                  { type: 'text', text: { content: 'Nested ' }, annotations: {} },
                  { type: 'text', text: { content: 'content' }, annotations: { italic: true } }
                ]
              }
            }
          ]
        }
      },
      {
        object: 'block',
        type: 'callout',
        callout: {
          rich_text: [{ type: 'text', text: { content: 'Unsupported Confluence macro: custom-macro' }, annotations: {} }],
          children: [
            {
              object: 'block',
              type: 'paragraph',
              paragraph: {
                rich_text: [{ type: 'text', text: { content: 'Recoverable body' }, annotations: {} }]
              }
            }
          ]
        }
      }
    ]);
  });

  it('falls back when Notion does not accept mermaid code language', () => {
    const parsed = parseConfluenceStorageXml(`
      <ac:structured-macro ac:name="mermaid">
        <ac:plain-text-body><![CDATA[sequenceDiagram\nAlice->>Bob: hello]]></ac:plain-text-body>
      </ac:structured-macro>
    `);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = convertConfluenceStorageToNotionBlocks(parsed.document, {
      acceptedCodeLanguages: new Set(['plain text'])
    });

    expect(result.blocks).toEqual([
      {
        object: 'block',
        type: 'code',
        code: {
          rich_text: [{ type: 'text', text: { content: 'sequenceDiagram\nAlice->>Bob: hello' }, annotations: {} }],
          language: 'plain text'
        }
      }
    ]);
    expect(result.degradations).toEqual([
      {
        type: 'macro-language-fallback',
        source: 'mermaid',
        message: 'Converted Mermaid macro to plain-text code because Notion language mermaid is not accepted.',
        severity: 'warning'
      }
    ]);
  });
});
