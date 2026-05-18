import { describe, expect, it } from 'vitest';

import { parseConfluenceStorageXml } from '../confluence';

describe('Confluence storage XML parser', () => {
  it('parses simple storage XML into an internal AST', () => {
    const result = parseConfluenceStorageXml('<h1>Title</h1><p>Hello <strong>world</strong></p>');

    expect(result).toEqual({
      ok: true,
      document: {
        type: 'document',
        children: [
          {
            type: 'element',
            name: 'h1',
            localName: 'h1',
            attributes: [],
            children: [{ type: 'text', text: 'Title' }]
          },
          {
            type: 'element',
            name: 'p',
            localName: 'p',
            attributes: [],
            children: [
              { type: 'text', text: 'Hello ' },
              {
                type: 'element',
                name: 'strong',
                localName: 'strong',
                attributes: [],
                children: [{ type: 'text', text: 'world' }]
              }
            ]
          }
        ]
      },
      degradations: []
    });
  });

  it('preserves Confluence namespace-qualified nodes and attributes', () => {
    const result = parseConfluenceStorageXml(
      '<ac:structured-macro ac:name="info"><ac:rich-text-body><p>Body</p></ac:rich-text-body></ac:structured-macro><ri:attachment ri:filename="diagram.png" />'
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.document.children[0]).toMatchObject({
      type: 'element',
      name: 'ac:structured-macro',
      localName: 'structured-macro',
      namespacePrefix: 'ac',
      attributes: [
        {
          name: 'ac:name',
          localName: 'name',
          namespacePrefix: 'ac',
          value: 'info'
        }
      ]
    });
    expect(result.document.children[1]).toMatchObject({
      type: 'element',
      name: 'ri:attachment',
      localName: 'attachment',
      namespacePrefix: 'ri',
      attributes: [
        {
          name: 'ri:filename',
          localName: 'filename',
          namespacePrefix: 'ri',
          value: 'diagram.png'
        }
      ]
    });
  });

  it('does not resolve external entities or make external requests', () => {
    const fetchCalls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      fetchCalls.push(String(input));
      return Promise.resolve(new Response('should not be fetched'));
    }) as typeof fetch;

    try {
      const result = parseConfluenceStorageXml('<!DOCTYPE x [<!ENTITY ext SYSTEM "https://attacker.example/entity">]><p>&ext;</p>');

      expect(fetchCalls).toEqual([]);
      expect(result).toEqual({
        ok: true,
        document: {
          type: 'document',
          children: [
            {
              type: 'element',
              name: 'p',
              localName: 'p',
              attributes: [],
              children: []
            }
          ]
        },
        degradations: [
          {
            type: 'external-entity-blocked',
            source: 'storage-xml',
            message: 'Blocked external entity declarations in Confluence storage XML.',
            severity: 'warning'
          }
        ]
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('converts unsupported raw HTML to recoverable plain text with a degradation', () => {
    const result = parseConfluenceStorageXml('<p>Before</p><script>alert(1)</script><button onclick="steal()">Run</button>');

    expect(result).toEqual({
      ok: true,
      document: {
        type: 'document',
        children: [
          {
            type: 'element',
            name: 'p',
            localName: 'p',
            attributes: [],
            children: [{ type: 'text', text: 'Before' }]
          },
          { type: 'text', text: 'alert(1)' },
          { type: 'text', text: 'Run' }
        ]
      },
      degradations: [
        {
          type: 'unsupported-raw-html',
          source: 'script',
          message: 'Converted unsupported raw HTML element script to plain text.',
          severity: 'warning'
        },
        {
          type: 'unsupported-raw-html',
          source: 'button',
          message: 'Converted unsupported raw HTML element button to plain text.',
          severity: 'warning'
        }
      ]
    });
  });

  it('fails the whole document on malformed XML', () => {
    expect(parseConfluenceStorageXml('<p>Unclosed')).toEqual({
      ok: false,
      reason: 'parse-error',
      message: expect.stringContaining('Malformed Confluence storage XML')
    });
  });
});
