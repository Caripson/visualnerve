export const infrastructureTemplateHints: Record<string, string> = {
  'api-compute-capacity': 'Requests → retained RAM → CPU + DB connection → response',
  'network-multi-site-capacity': 'Two sites → fair-share backbone → processing → acknowledgement',
  'energy-power-capacity': 'Generation + grid + battery → delivered energy → completion',
  'datacenter-capacity': 'Site requests + WAN + RAM + parallel CPU/energy + database',
};
/** Small semantic thumbnails; the editable example supplies the actual runnable model. */
export function InfrastructureTemplatePreview({ templateKey }: { templateKey: string }) {
  const network = templateKey === 'network-multi-site-capacity',
    energy = templateKey === 'energy-power-capacity',
    combined = templateKey === 'datacenter-capacity';
  const labels = network
    ? ['Site A', 'Link', 'Receive']
    : energy
      ? ['Supply', 'Battery', 'Load']
      : combined
        ? ['WAN', 'CPU + RAM', 'DB']
        : ['Requests', 'CPU + DB', 'Response'];
  return (
    <svg viewBox="0 0 140 64" style={{ width: '96%', height: '96%' }}>
      <path d="M36 33H52M89 33H104" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M47 30L52 33L47 36M99 30L104 33L99 36" fill="none" stroke="currentColor" />
      {[5, 52, 104].map((x, index) => (
        <g key={x}>
          <rect
            x={x}
            y={19}
            width={index === 1 ? 37 : 31}
            height={27}
            rx={energy && index === 1 ? 2 : 6}
            fill="var(--surface)"
            stroke="currentColor"
          />
          <text
            x={x + (index === 1 ? 18.5 : 15.5)}
            y={35}
            textAnchor="middle"
            fill="currentColor"
            fontSize={6}
          >
            {labels[index]}
          </text>
        </g>
      ))}
      {network ? (
        <path d="M20 7V19M7 7H33" fill="none" stroke="currentColor" />
      ) : energy ? (
        <path d="M8 7H26M17 3V11M65 16H75" fill="none" stroke="currentColor" />
      ) : (
        <path d="M57 15V9H85V15M63 9V5M70 9V5M77 9V5" fill="none" stroke="currentColor" />
      )}
    </svg>
  );
}
