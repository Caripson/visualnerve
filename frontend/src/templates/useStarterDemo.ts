import { useEffect, useRef } from 'react';
import { useEditor } from '../state/editor';
import { createTemplateDiagram } from './create';

/** Open the editable example only after the user has accepted browser storage. */
export function useStarterDemo(ready: boolean, acknowledged: boolean) {
  const started = useRef(false);
  useEffect(() => {
    if (!ready || !acknowledged || started.current) return;
    if (new URL(location.href).searchParams.get('demo') !== 'kiosk') return;
    started.current = true;
    void createTemplateDiagram('process-simulator', 'Kiosk package pickup')
      .then(() => {
        const url = new URL(location.href);
        if (url.searchParams.get('demo') === 'kiosk') url.searchParams.delete('demo');
        history.replaceState(history.state, '', url.pathname + url.search + url.hash);
      })
      .catch((error) => useEditor.setState({ status: 'error', message: (error as Error).message }));
  }, [ready, acknowledged]);
}
