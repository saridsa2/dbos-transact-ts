/** Resolve both receipts before publishing a UI snapshot; never clear live work between polls. */
export async function readSetupProgress(request: (path: string) => Promise<any>, id: string) {
  const next = await request(`setup-runs/${id}`);
  const workId = next.request?.work_item_id;
  if (!workId) return next;
  const work = await request(`work-items/${workId}`);
  return { ...next, work };
}
