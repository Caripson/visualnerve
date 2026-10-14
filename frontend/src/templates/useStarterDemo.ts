import { useEffect, useRef } from 'react';
import { useEditor } from '../state/editor';
import { createTemplateDiagram } from './create';

const starterExamples: Record<string, { template: string; name: string }> = {
  kiosk: { template: 'process-simulator', name: 'Kiosk package pickup' },
  'time-series-analysis': { template: 'time-series-analysis', name: 'Growth & Churn' },
  'api-compute-capacity': { template: 'api-compute-capacity', name: 'API & Compute Capacity' },
  'network-multi-site-capacity': {
    template: 'network-multi-site-capacity',
    name: 'Network & Multi-Site Capacity',
  },
  'energy-power-capacity': {
    template: 'energy-power-capacity',
    name: 'Energy & Power Capacity',
  },
  'datacenter-capacity': { template: 'datacenter-capacity', name: 'Datacenter Capacity' },
};

/** Open the editable example only after the user has accepted browser storage. */
export function useStarterDemo(ready: boolean, acknowledged: boolean) {
  const started = useRef(false);
  useEffect(() => {
    if (!ready || !acknowledged || started.current) return;
    const demo = new URL(location.href).searchParams.get('demo');
    const example = demo && Object.hasOwn(starterExamples, demo) ? starterExamples[demo] : null;
    if (!example) return;
    started.current = true;
    void createTemplateDiagram(example.template, example.name)
      .then(() => {
        const url = new URL(location.href);
        if (url.searchParams.get('demo') === demo) url.searchParams.delete('demo');
        history.replaceState(history.state, '', url.pathname + url.search + url.hash);
      })
      .catch((error) => useEditor.setState({ status: 'error', message: (error as Error).message }));
  }, [ready, acknowledged]);
}
