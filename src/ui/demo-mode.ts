/** Legacy controls are opt-in; existing saved agents retain their identity. */
export function devinEnabled(): boolean {
  return import.meta.env.VITE_ENABLE_DEVIN === 'true';
}
