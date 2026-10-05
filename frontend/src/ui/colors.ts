export const colorPalette = [
  { name: 'Forest', value: '#23664d' },
  { name: 'Teal', value: '#226d72' },
  { name: 'Blue', value: '#37648d' },
  { name: 'Amber', value: '#8f6123' },
  { name: 'Coral', value: '#b65344' },
  { name: 'Plum', value: '#775491' },
  { name: 'Berry', value: '#984f6d' },
  { name: 'Charcoal', value: '#36443e' },
];
export function luminance(color: string) {
  const hex = /^#[\da-f]{6}$/i.test(color) ? color.slice(1) : '23664d';
  const rgb = hex.match(/../g)!.map((c) => {
    const value = parseInt(c, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
export function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
export function topicInk(color: string) {
  return contrast(color, '#ffffff') >= contrast(color, '#000000') ? '#ffffff' : '#000000';
}
