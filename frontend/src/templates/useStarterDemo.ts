import { useEffect, useRef } from 'react';
import { useEditor } from '../state/editor';
import { createTemplateDiagram } from './create';

/** Open the editable example only after the user has accepted browser storage. */
export function useStarterDemo(ready: boolean, acknowledged: boolean) {
  const started = useRef(false);
  useEffect(() => {
    if (!ready || !acknowledged || started.current) return;
    const demo = new URL(location.href).searchParams.get('demo');
    if (!['kiosk', 'time-series-analysis'].includes(demo ?? '')) return;
    started.current = true;
    void createTemplateDiagram(
      demo === 'kiosk' ? 'process-simulator' : 'time-series-analysis',
      demo === 'kiosk' ? 'Kiosk package pickup' : 'Growth & Churn',
    )
      .then(() => {
        const url = new URL(location.href);
        if (url.searchParams.get('demo') === demo) url.searchParams.delete('demo');
        history.replaceState(history.state, '', url.pathname + url.search + url.hash);
      })
      .catch((error) => useEditor.setState({ status: 'error', message: (error as Error).message }));
  }, [ready, acknowledged]);
}
