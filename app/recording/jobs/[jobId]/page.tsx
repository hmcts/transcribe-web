import { HearingPage } from "@/components/recording/transcript/hearing-page";

interface PageProps {
  params: Promise<{ jobId: string }>;
}

// DIAAT-334: loaded in the browser, in the tab's jurisdiction (HearingPage).
// DIAAT-428: the id is the hearing's; a recording from before hearings is a
// one-day hearing with its own id, so its links still work.
export default async function TranscriptPage({ params }: PageProps) {
  const { jobId } = await params;
  return <HearingPage hearingId={jobId} />;
}
