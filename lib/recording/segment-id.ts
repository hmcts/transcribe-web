// transcribe-api's segment ids (DialogueEntry.id).
export function isSegmentId(value: string): boolean {
  return /^seg_[0-9a-f]{32}$/.test(value);
}
