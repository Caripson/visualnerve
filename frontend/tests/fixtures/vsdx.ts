import { strToU8, zipSync } from 'fflate';

const core = 'http://schemas.microsoft.com/office/visio/2012/main';
const relationshipNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const visioRelationships = 'http://schemas.microsoft.com/visio/2010/relationships';
export const visioXml = (root: string, content: string) =>
  `<?xml version="1.0" encoding="utf-8"?><${root} xmlns="${core}" xmlns:r="${relationshipNamespace}">${content}</${root}>`;
const rels = (values: Array<[string, string, string]>) =>
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${values.map(([id, type, target]) => `<Relationship Id="${id}" Type="${visioRelationships}/${type}" Target="${target}"/>`).join('')}</Relationships>`;
export function visioPackageParts(
  page = '<Shapes><Shape ID="1" NameU="Box"><Cell N="PinX" V="2"/><Cell N="PinY" V="3"/><Cell N="Width" V="2"/><Cell N="Height" V="1"/><Text>Hello</Text></Shape></Shapes>',
): Record<string, string> {
  return {
    '[Content_Types].xml':
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/></Types>',
    '_rels/.rels': rels([['rDocument', 'document', 'visio/document.xml']]),
    'visio/document.xml': visioXml('VisioDocument', ''),
    'visio/_rels/document.xml.rels': rels([['rPages', 'pages', 'pages/pages.xml']]),
    'visio/pages/pages.xml': visioXml(
      'Pages',
      '<Page ID="7" Name="Operations"><PageSheet><Cell N="PageHeight" V="10"/><Cell N="PageWidth" V="8"/></PageSheet><Rel r:id="rActual"/></Page>',
    ),
    'visio/pages/_rels/pages.xml.rels': rels([['rActual', 'page', 'page42.xml']]),
    'visio/pages/page42.xml': visioXml('PageContents', page),
  };
}
export function vsdxFixture(parts = visioPackageParts()) {
  return zipSync(
    Object.fromEntries(Object.entries(parts).map(([name, value]) => [name, strToU8(value)])),
  );
}
export const visioRels = rels;
