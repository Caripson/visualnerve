import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { appLocaleController } from '../src/i18n/runtime';
await appLocaleController.start();
afterEach(cleanup);
