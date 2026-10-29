import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <Suspense
      fallback={<p className="mx-auto w-full max-w-sm px-4 py-12 text-sm text-zinc-500">Loading…</p>}
    >
      <LoginForm />
    </Suspense>
  );
}
