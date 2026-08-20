"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Two-step email + 6-digit code flow, not a clickable magic link.
// Outlook (and some other corporate mail scanners) pre-visit links in
// emails to scan them for phishing, which silently consumes a one-time
// magic link before the user ever taps it. A typed code can't be
// "used up" that way.
export default function AdminLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    setStatus("working");
    setErrorMessage(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // Kept as a fallback in case the email link is used instead of the
        // code on a device where link-scanning isn't an issue.
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }

    setStatus("idle");
    setStep("code");
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setStatus("working");
    setErrorMessage(null);

    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }

    // refresh() forces the server to re-read the session cookie that
    // verifyOtp just set, so the protected layout sees us as signed in.
    router.push("/admin");
    router.refresh();
  }

  if (step === "code") {
    return (
      <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
        <div>
          <h1 className="text-xl font-semibold">Enter your code</h1>
          <p className="mt-1 text-sm text-neutral-500">
            We sent a 6-digit code to {email}. Enter it below.
          </p>
        </div>

        <form onSubmit={handleVerifyCode} className="flex flex-col gap-3">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            className="rounded-md border border-neutral-300 px-3 py-2 text-center text-lg tracking-widest"
          />
          <button
            type="submit"
            disabled={status === "working"}
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {status === "working" ? "Verifying..." : "Verify and sign in"}
          </button>
          {status === "error" && (
            <p className="text-sm text-red-600">{errorMessage}</p>
          )}
          <button
            type="button"
            onClick={() => {
              setStep("email");
              setCode("");
              setStatus("idle");
              setErrorMessage(null);
            }}
            className="text-sm text-neutral-500 hover:underline"
          >
            Use a different email
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="text-xl font-semibold">Staff sign in</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Enter your work email and we&apos;ll send you a sign-in code.
        </p>
      </div>

      <form onSubmit={handleSendCode} className="flex flex-col gap-3">
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
          disabled={status === "working"}
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {status === "working" ? "Sending..." : "Send sign-in code"}
        </button>
        {status === "error" && (
          <p className="text-sm text-red-600">{errorMessage}</p>
        )}
      </form>
    </div>
  );
}
