import type { Metadata } from "next";
import { Suspense } from "react";
import { NO_INDEX } from "@/lib/site";
import { LoginForm } from "./login-form";
import { LoginSkeleton } from "@/app/skeletons";

export const metadata: Metadata = { title: "Sign in", robots: NO_INDEX };

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginSkeleton />}>
      <LoginForm />
    </Suspense>
  );
}
