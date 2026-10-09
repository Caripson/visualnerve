import { SvgModelRenderer } from './svg-model-renderer';
import { CanvasSvgTextMeasurer } from './svg-native';
import { LocaleCatalogLoader } from '../i18n/catalog-loader';
import { MessageFormatter } from '../i18n/message-formatter';
import { SvgExportError, type SvgWorkerRequest, type SvgWorkerResponse } from './svg-job-types';
const send = (response: SvgWorkerResponse) => self.postMessage(response);
self.onmessage = async (event: MessageEvent<SvgWorkerRequest>) => {
  try {
    const request = event.data;
    const catalog = await new LocaleCatalogLoader().load(request.locale);
    const result = new SvgModelRenderer(new CanvasSvgTextMeasurer()).render(
      request,
      new MessageFormatter(request.locale, catalog),
      send,
    );
    send({ type: 'result', ...result });
  } catch (error) {
    send({
      type: 'error',
      code: error instanceof SvgExportError ? error.code : 'SVG_RENDER_FAILED',
      message: error instanceof Error ? error.message : 'Could not generate vector SVG.',
    });
  }
};
