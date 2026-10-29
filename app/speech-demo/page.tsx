import { SpeechDemo } from "@/components/audio/dictation";
import DictationPageTracker from "@/providers/dictation-page-tracker";

export default function SpeechDemoPage() {
  return (
    <div className="fixed inset-0 top-14">
      <DictationPageTracker />
      <SpeechDemo />
    </div>
  );
}
