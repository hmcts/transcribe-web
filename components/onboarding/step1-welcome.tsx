import Image from "next/image";

export default function Step1Welcome() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header and Description - Single Column */}
      <div className="space-y-3 text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Welcome 👋
        </h1>
        <p className="mx-auto max-w-2xl text-lg leading-relaxed text-gray-900">
          Judicial Transcribe is an AI assistant that transcribes and summarises
          meetings. Turning conversations into clear case notes in minutes so
          you can stay fully present with people.
        </p>
      </div>

      {/* Quote and Image - Two Columns */}
      <div className="grid items-center gap-8 lg:grid-cols-2">
        {/* Quote */}
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50 p-6">
          <blockquote className="mb-3 text-lg font-medium italic text-gray-900">
            &quot;I&apos;m spending a lot more time with the people, which is
            what I wanted to do in the job.&quot;
          </blockquote>
          <cite className="text-sm font-medium text-gray-600">
            — Wales Probation Officer
          </cite>
        </div>

        {/* Image */}
        <div className="flex justify-center lg:justify-end">
          <Image
            src="/Probation officer listening.png"
            alt="Probation officer listening attentively to client"
            width={280}
            height={280}
            className="h-auto max-w-full rounded-2xl object-cover"
            style={{ maxHeight: "280px", width: "auto" }}
          />
        </div>
      </div>
    </div>
  );
}
