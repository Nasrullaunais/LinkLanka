export const ExpoKeepAwakeTag = 'ExpoKeepAwakeDefaultTag';

type KeepAwakeListener = (...args: unknown[]) => void;

type KeepAwakeOptions = {
  listener?: KeepAwakeListener;
  suppressDeactivateWarnings?: boolean;
};

export function useKeepAwake(_tag?: string, _options?: KeepAwakeOptions): void {
  // Intentionally disabled for this app.
}

export async function activateKeepAwakeAsync(
  _tag: string = ExpoKeepAwakeTag
): Promise<void> {
  return;
}

export async function activateKeepAwake(
  _tag: string = ExpoKeepAwakeTag
): Promise<void> {
  return;
}

export async function deactivateKeepAwake(
  _tag: string = ExpoKeepAwakeTag
): Promise<void> {
  return;
}

export async function isAvailableAsync(): Promise<boolean> {
  return false;
}

export function addListener(
  _tagOrListener?: string | KeepAwakeListener,
  _listener?: KeepAwakeListener
): { remove: () => void } {
  return { remove: () => {} };
}
