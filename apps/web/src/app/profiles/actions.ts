"use server";

import { redirect } from "next/navigation";
import { createProfile, deleteProfile, parseProfileInput } from "@/lib/profiles";

export async function createProfileAction(
  _prev: { error?: string },
  form: FormData,
): Promise<{ error?: string }> {
  const input = parseProfileInput(form);
  if ("error" in input) return { error: input.error };
  const id = await createProfile(input);
  redirect(`/profiles/${id}`);
}

export async function deleteProfileAction(form: FormData) {
  await deleteProfile(String(form.get("id") ?? ""));
  redirect("/profiles");
}
