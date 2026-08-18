"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    setStatus(error ? "error" : "sent");
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="text-xl font-semibold">Staff sign in</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Enter your work email and we&apos;ll send you a sign-in link.
        </p>
      </div>

      {status === "sent" ? (
        <p className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-800">
          Check your inbox for a sign-in link.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={status === "sending"}
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {status === "sending" ? "Sending..." : "Send sign-in link"}
          </button>
          {status === "error" && (
            <p className="text-sm text-red-600">
              Something went wrong. Please try again.
            </p>
          )}
        </form>
      )}
    </div>
  );
}
