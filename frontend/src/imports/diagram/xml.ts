import { SaxesParser } from 'saxes';
import { decodeHTML } from 'entities';
import { diagramImportLimits } from './types';

export interface XmlNode {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  content: (string | XmlNode)[];
  text: string;
}

/** Worker-safe XML tree. No DTD, external resolver, DOM insertion or fetch. */
export function parseXml(text: string): XmlNode {
  if (new TextEncoder().encode(text).length > diagramImportLimits.expandedBytes)
    throw new Error('Diagram XML exceeds the 64 MiB expanded limit.');
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text))
    throw new Error('Diagram XML must not contain DTD or entity declarations.');
  let root: XmlNode | undefined;
  let elements = 0;
  const stack: XmlNode[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on('error', (error) => {
    throw new Error(`Invalid diagram XML: ${error.message}`);
  });
  parser.on('doctype', () => {
    throw new Error('Diagram XML DTDs are unsupported.');
  });
  parser.on('opentag', (tag) => {
    if (++elements > diagramImportLimits.xmlElements)
      throw new Error('Diagram XML exceeds the element limit.');
    if (stack.length >= diagramImportLimits.xmlDepth)
      throw new Error('Diagram XML is nested too deeply.');
    const node: XmlNode = {
      name: tag.local,
      attributes: Object.fromEntries(
        Object.values(tag.attributes).map((attribute) => [attribute.name, attribute.value]),
      ),
      children: [],
      content: [],
      text: '',
    };
    const parent = stack.at(-1);
    if (parent) {
      parent.children.push(node);
      parent.content.push(node);
    } else if (root) throw new Error('Diagram XML has multiple roots.');
    else root = node;
    stack.push(node);
  });
  const content = (value: string) => {
    const node = stack.at(-1);
    if (node) {
      node.text += value;
      node.content.push(value);
    }
  };
  parser.on('text', content);
  parser.on('cdata', content);
  parser.on('closetag', () => {
    stack.pop();
  });
  parser.write(text).close();
  if (!root) throw new Error('Diagram XML has no document root.');
  return root;
}
export const children = (node: XmlNode, name?: string) =>
  name === undefined ? node.children : node.children.filter((child) => child.name === name);
export const first = (node: XmlNode, name: string) =>
  node.children.find((child) => child.name === name);
export function descendants(node: XmlNode, name: string): XmlNode[] {
  const found: XmlNode[] = [];
  const queue = [...node.children];
  for (let index = 0; index < queue.length; index++) {
    const child = queue[index];
    if (child.name === name) found.push(child);
    for (const descendant of child.children) queue.push(descendant);
  }
  return found;
}
export const attr = (node: XmlNode, name: string): string | undefined =>
  Object.hasOwn(node.attributes, name)
    ? node.attributes[name]
    : Object.entries(node.attributes).find(
        ([key]) => key.split(':').at(-1) === name.split(':').at(-1),
      )?.[1];
export function textContent(node: XmlNode): string {
  return node.content
    .map((entry) => (typeof entry === 'string' ? entry : textContent(entry)))
    .join('');
}
/** Imported rich text becomes literal text; it never enters innerHTML. */
export function plainText(value: string): string {
  return decodeHTML(
    value
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<br\b[^>]*>/gi, '\n')
      .replace(/<\/(?:div|p|li|h[1-6])\s*>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .trim();
}
const colors: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  gray: '#808080',
  grey: '#808080',
  orange: '#ffa500',
  purple: '#800080',
};
export function safeColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const color = value.trim().toLowerCase();
  return /^#(?:[a-f\d]{3}|[a-f\d]{6}|[a-f\d]{8})$/.test(color)
    ? color
    : Object.hasOwn(colors, color)
      ? colors[color]
      : undefined;
}
