import { AppUpdateController } from './app-update-controller';

export const appUpdates =
  typeof window !== 'undefined' && 'serviceWorker' in navigator
    ? new AppUpdateController(navigator.serviceWorker, window, document)
    : undefined;
