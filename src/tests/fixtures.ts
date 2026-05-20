export const releaseFixtureNames = ['simple', 'macro-heavy', 'image-heavy'] as const;

export type ReleaseFixtureName = (typeof releaseFixtureNames)[number];

export interface ReleaseFixture {
  name: ReleaseFixtureName;
  storageXml: string;
}

export const releaseFixtures: Record<ReleaseFixtureName, ReleaseFixture> = {
  simple: {
    name: 'simple',
    storageXml: `
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
`
  },
  'macro-heavy': {
    name: 'macro-heavy',
    storageXml: `
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
`
  },
  'image-heavy': {
    name: 'image-heavy',
    storageXml: `
<p>Images</p>
<ac:image><ri:url ri:value="/confluence/download/attachments/123/in-path.png" /></ac:image>
<ac:image><ri:attachment ri:filename="diagram.png" /></ac:image>
<ac:image><ri:url ri:value="https://cdn.example.net/photo.png" /></ac:image>
<ac:image><ri:url ri:value="https://wiki.example.com/download/attachments/123/broken.png" /></ac:image>
<ac:structured-macro ac:name="drawio">
  <ac:parameter ac:name="previewUrl">/download/attachments/123/Architecture.png</ac:parameter>
  <ac:parameter ac:name="sourceUrl">/download/attachments/123/Architecture.drawio</ac:parameter>
  <ac:parameter ac:name="diagramName">Architecture</ac:parameter>
</ac:structured-macro>
`
  }
};
