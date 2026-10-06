import { describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import {
  attr,
  children,
  descendants,
  first,
  parseXml,
  plainText,
  safeColor,
  textContent,
} from '../src/imports/diagram/xml';
import { diagramImportLimits } from '../src/imports/diagram/types';
import { VisioPackage } from '../src/imports/diagram/vsdx-zip';

describe('worker-safe diagram XML helpers', () => {
  it.each(['le', 'be'])('decodes UTF-16%s XML parts inside a Visio package', (order) => {
    const xml = '<?xml version="1.0" encoding="utf-16"?><Text>Räksmörgås 日本語</Text>';
    const bytes = new Uint8Array(2 + xml.length * 2);
    bytes.set(order === 'le' ? [0xff, 0xfe] : [0xfe, 0xff]);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < xml.length; index++)
      view.setUint16(2 + index * 2, xml.charCodeAt(index), order === 'le');
    const archive = new VisioPackage(zipSync({ 'visio/document.xml': bytes }));
    expect(textContent(parseXml(archive.text('visio/document.xml')))).toBe('Räksmörgås 日本語');
  });

  it('preserves mixed text order, entities and CDATA across descendants', () => {
    const root = parseXml(
      '<Text>First<cp IX="0"/>Second &amp; third<pp IX="1">Fourth<![CDATA[<fifth>]]></pp>Last</Text>',
    );
    expect(textContent(root)).toBe('FirstSecond & thirdFourth<fifth>Last');
    expect(root.text).toBe('FirstSecond & thirdLast');
    expect(children(root).map((entry) => entry.name)).toEqual(['cp', 'pp']);
    expect(first(root, 'pp')?.text).toBe('Fourth<fifth>');
    expect(descendants(root, 'cp')).toHaveLength(1);
  });

  it('supports namespaced Visio attributes without reading inherited properties', () => {
    const root = parseXml('<Page xmlns:r="urn:relationships" ID="1"><Rel r:id="rId1"/></Page>');
    expect(attr(first(root, 'Rel')!, 'id')).toBe('rId1');
    expect(attr(root, 'ID')).toBe('1');
    expect(attr(root, 'constructor')).toBeUndefined();
    expect(attr(root, 'toString')).toBeUndefined();
    expect(attr(root, '__proto__')).toBeUndefined();
  });

  it.each([
    '<!DOCTYPE root SYSTEM "https://evil.test/schema"><root/>',
    '<!DOCTYPE root [<!ENTITY leak SYSTEM "file:///etc/passwd">]><root>&leak;</root>',
    '<!DOCTYPE root [<!ENTITY a "x"><!ENTITY b "&a;&a;">]><root>&b;</root>',
    '<!ENTITY a "x"><root/>',
    '<root>&unknown;</root>',
    '<root><child></root>',
    '<root/><another/>',
    '<root duplicate="1" duplicate="2"/>',
  ])('rejects external declarations, invalid entities and malformed XML', (source) => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    try {
      expect(() => parseXml(source)).toThrow();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects deeply nested XML instead of overflowing the parser or text traversal', () => {
    const source =
      '<root>'.repeat(diagramImportLimits.xmlDepth + 1) +
      '</root>'.repeat(diagramImportLimits.xmlDepth + 1);
    expect(() => parseXml(source)).toThrow(/nested too deeply/);
  });

  it('strips rich label markup, event attributes, scripts and styles without a DOM', () => {
    vi.stubGlobal('DOMParser', undefined);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    try {
      expect(
        plainText(
          '<style>body{background:url(https://evil.test)}</style><script>alert(1)</script><div onclick="alert(2)">Hello&nbsp;<b>world</b></div><p>Next<br/>line</p><img src="https://evil.test/tracker">',
        ),
      ).toBe('Hello world\nNext\nline');
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ['#ABC', '#abc'],
    ['#112233', '#112233'],
    ['#AABBCCDD', '#aabbccdd'],
    ['red', '#ff0000'],
    [' Blue ', '#0000ff'],
  ])('normalizes supported color %s', (source, expected) => {
    expect(safeColor(source)).toBe(expected);
  });

  it.each([
    'constructor',
    'toString',
    '__proto__',
    'url(javascript:evil)',
    'expression(alert(1))',
    '#xyz',
    '#12345',
    'var(--secret)',
    'transparent',
    'default',
    'none',
  ])('rejects unsafe or unsupported color %s', (source) => {
    expect(safeColor(source)).toBeUndefined();
  });
});
