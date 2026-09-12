export function shouldReportPaneExited(
  supervisor: { has(paneId: string): boolean },
  routingPending: boolean,
  paneId: string,
): boolean {
  return !routingPending && !supervisor.has(paneId);
}
