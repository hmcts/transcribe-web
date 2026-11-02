import { JobPage } from "@/components/recording/transcript/job-page";

interface PageProps {
  params: Promise<{ jobId: string }>;
}

// DIAAT-334: loaded in the browser, in the tab's jurisdiction (JobPage).
export default async function TranscriptPage({ params }: PageProps) {
  const { jobId } = await params;
  return <JobPage jobId={jobId} />;
}
