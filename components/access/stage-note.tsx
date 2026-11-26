import { type JurisdictionStage, stageNote } from "@/lib/jurisdiction-api";

/** DIAAT-345: a jurisdiction its admins or testers see before it is live. */
export function StageNote({ stage }: { stage: JurisdictionStage | undefined }) {
  const note = stageNote(stage);
  if (!note) return null;
  return (
    <>
      {" "}
      <span className="ml-2 rounded border px-1.5 text-xs font-normal text-muted-foreground">
        <span className="sr-only">(</span>
        {note}
        <span className="sr-only">: not live yet)</span>
      </span>
    </>
  );
}
