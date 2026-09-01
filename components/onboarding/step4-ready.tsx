export default function Step4Ready() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-4 text-center">
        <h1 className="text-4xl font-semibold sm:text-5xl">
          You&apos;re ready 🎉
        </h1>
        <p className="text-xl text-gray-700">
          Start today to spend less time note taking and more time listening
        </p>
      </div>

      {/* Quote */}
      <div className="rounded-lg border-l-4 border-green-500 bg-gradient-to-r from-green-50 to-emerald-50 p-8">
        <blockquote className="text-lg italic text-gray-800">
          &quot;The Judicial Transcribe AI has been life-saving… the amount of
          time it saves is invaluable.&quot;
        </blockquote>
        <cite className="mt-3 block text-base font-medium text-gray-600">
          — KSS Probation Service Officer
        </cite>
      </div>
    </div>
  );
}
