import Link from "next/link";
import { Button } from "@/components/recording/ui/button";
import { RECORDING_HOME } from "@/lib/recording/routes";

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-bold">Transcript not found</h1>
      <p className="text-muted-foreground">
        This job may still be processing or does not exist.
      </p>
      <Button asChild>
        <Link href={RECORDING_HOME}>Back to dashboard</Link>
      </Button>
    </main>
  );
}
