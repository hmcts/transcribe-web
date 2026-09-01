// import React from "react";
// import { Card, CardContent } from "@/components/ui/card";
// import { useTranscripts } from "@/providers/transcripts";
// import TranscriptEditor from "@/components/transcription/transcript-editor";
// import * as Collapsible from "@radix-ui/react-collapsible";
// import { ChevronDown } from "lucide-react";
// import SpeakerEditor from "./speaker-editor";

// function SpeakerEditorPreMinutes() {
//   const { currentTranscription, setCurrentMinutingStage } = useTranscripts();

//   if (!currentTranscription) return null;

//   return (
//     <div className="flex w-full justify-center">
//       <div className="mx-1 mt-8 w-[700px] space-y-4">
//         <Card>
//           <CardContent className="p-6">
//             <div className="mb-6 text-center">
//               <h2 className="text-2xl font-semibold text-slate-800">
//                 Detected Speakers
//               </h2>
//               <p className="mt-3 text-slate-600">
//                 Names have been predicted by AI. Please review and correct any
//                 mistakes - these names will be used to generate the AI summary
//                 in the next step.
//               </p>
//             </div>

//             <div className="space-y-4">
//               <p className="font-medium text-slate-700">Detected Speakers:</p>
//               <SpeakerEditor />

//               <div className="h-[2px] w-full bg-gray-100" />

//               <Collapsible.Root className="w-full" defaultOpen={false}>
//                 <Collapsible.Trigger className="flex w-full items-center justify-between rounded-md bg-slate-50 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
//                   <span>View Full Transcript</span>
//                   <ChevronDown className="size-4 transition-transform duration-200 ease-in-out group-data-[state=open]:rotate-180" />
//                 </Collapsible.Trigger>
//                 <Collapsible.Content className="data-[state=closed]:animate-slideUp data-[state=open]:animate-slideDown overflow-hidden">
//                   <div className="pt-2">
//                     <TranscriptEditor currentCitationIndex={null} />
//                   </div>
//                 </Collapsible.Content>
//               </Collapsible.Root>
//             </div>
//           </CardContent>
//         </Card>

//         <div className="flex justify-end">
//           <button
//             type="button"
//             onClick={() => setCurrentMinutingStage("final-minutes")}
//             className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
//           >
//             Continue to AI Summary →
//           </button>
//         </div>
//       </div>
//     </div>
//   );
// }

// export default SpeakerEditorPreMinutes;
