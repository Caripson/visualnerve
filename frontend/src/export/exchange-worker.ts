import { exchangeScene } from './exchange-scene';
import {
  ExchangeExportError,
  type ExchangeWorkerRequest,
  type ExchangeWorkerResponse,
} from './exchange-types';
const send = (response: ExchangeWorkerResponse) => self.postMessage(response);
self.onmessage = async (event: MessageEvent<ExchangeWorkerRequest>) => {
  try {
    const { graph, format, options, theme } = event.data;
    send({ type: 'progress', progress: 5, phase: 'projection' });
    const scene = exchangeScene(graph, options, theme);
    const progress = (percent: number, phase: 'projection' | 'nodes' | 'edges' | 'packaging') =>
      send({ type: 'progress', progress: percent, phase });
    const result =
      format === 'drawio'
        ? (await import('./exchange-drawio')).serializeDrawio(scene, progress)
        : (await import('./exchange-visio')).serializeVisio(scene, progress);
    self.postMessage({ type: 'result', result } satisfies ExchangeWorkerResponse, {
      transfer: [result.bytes.buffer as ArrayBuffer],
    });
  } catch (error) {
    send({
      type: 'error',
      code: error instanceof ExchangeExportError ? error.code : 'EXCHANGE_EXPORT_FAILED',
      message: error instanceof Error ? error.message : 'Could not export this diagram.',
    });
  }
};
