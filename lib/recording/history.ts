/**
 * A recording's audit history (DIAAT-395), as the browser reads it from this
 * app's `/api/hearings/{id}/history` route: who did what to the hearing and its
 * days, when, in which role, and how it ended. No transcript text is ever in it.
 */
export interface HistoryEntry {
  id: string;
  timestamp: string;
  action: string;
  actor_label: string;
  actor_role: string | null;
  outcome: string;
  // DIAAT-428: the recording day the row is about, if it is about one.
  job_id?: string | null;
}

export interface HistoryPage {
  items: HistoryEntry[];
  total: number;
}

export const HISTORY_PAGE_SIZE = 20;

/** What an audit action reads as. An action this release does not know is shown as the API sent it. */
export function describeHistoryAction(action: string): string {
  switch (action) {
    case "job.submit":
      return "Recording submitted";
    case "transcript.view":
      return "Transcript viewed";
    case "transcript.edit":
      return "Transcript edited";
    case "transcript.rename_speaker":
      return "Speaker renamed";
    case "transcript.rollback":
      return "Edit rolled back";
    case "transcript.accept":
      return "Segment accepted";
    case "audio.export":
      return "Audio exported";
    case "job.delete":
      return "Recording deleted";
    case "hearing.add_recording":
      return "Recording added";
    case "hearing.edit":
      return "Hearing date changed";
    case "hearing.delete":
      return "Hearing deleted";
    default:
      return action;
  }
}

/** An outcome (`success`, `denied`, ...) as a short word. */
export function describeOutcome(outcome: string): string {
  const text = outcome.replace(/[_.]/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : outcome;
}
