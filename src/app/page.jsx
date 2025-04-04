import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-indigo-900 to-purple-800 flex flex-col items-center justify-center p-4">
      <div className="text-center max-w-md bg-white/10 backdrop-blur-lg rounded-2xl p-12 shadow-2xl border border-white/20">
        <h1 className="text-5xl font-bold text-white mb-2">Rigs n Gigs</h1>
        <p className="text-white/80 mb-8">Find your perfect equipment rental</p>
        
        <Link
          href="/auth"
          className="inline-block bg-white text-indigo-900 px-8 py-3 rounded-full text-lg font-semibold hover:bg-indigo-100 transition-all duration-300 transform hover:scale-105 shadow-lg"
        >
          Get Started →
        </Link>
      </div>
    </main>
  );
}