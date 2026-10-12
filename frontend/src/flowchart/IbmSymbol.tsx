import type { IBMSymbol } from './ibm-symbols';
import './ibm-nodes.css';

export function IbmSymbolGlyph({
  symbol,
  className,
  size,
}: {
  symbol: IBMSymbol;
  className?: string;
  size?: number;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={size == null ? '0 0 100 100' : '-1 -1 102 102'}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        className="ibm-symbol-outline"
        d={symbol.outlinePath}
        vectorEffect="non-scaling-stroke"
      />
      {symbol.detailPaths.map((d, index) => (
        <path key={index} className="ibm-symbol-detail" d={d} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}
