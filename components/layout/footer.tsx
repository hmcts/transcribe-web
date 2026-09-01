"use client";

import Link from "next/link";
/* eslint-disable react/require-default-props */
/* eslint-disable react/react-in-jsx-scope */
import { cn } from "@/lib/utils";

export default function Footer({ className }: { className?: string }) {
  return (
    <footer
      className={cn("mt-auto w-full bg-black px-4 py-2 text-white", className)}
    >
      <div className="mx-auto max-w-7xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-8">
            <nav className="flex gap-6">
              <Link href="/privacy">Privacy</Link>
              <Link href="/support">Support</Link>
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <div className="rounded-full bg-pink-600 p-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="size-5 text-white"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v4a1 1 0 102 0V7zm-1 8a1 1 0 100-2 1 1 0 000 2z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="text-sm">
              <p>
                This is a new service. Your{" "}
                <Link
                  href="https://forms.gle/C3pWPmv6eyoE6qKY8"
                  className="underline hover:text-pink-400"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  feedback
                </Link>{" "}
                will help us to improve it
              </p>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
