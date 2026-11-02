"use client";

import { useCallback, useState } from "react";
import type { PersonalAccessToken, TokenScope } from "@ujc/core";
import { Badge, Button, EmptyState, Spinner, TextField, Toggle, useToast } from "@ujc/ui";
import { ApiError, createToken, listTokens, revokeToken } from "@/lib/api";
import { useApi } from "@/lib/use-api";

const SCOPES: ReadonlyArray<{ value: TokenScope; label: string; hint: string }> = [
  { value: "jobs:read", label: "Read jobs", hint: "Feed, job detail and live search." },
  {
    value: "applications:write",
    label: "Read & write applications",
    hint: "List, save and update tracked applications.",
  },
];

const DEFAULT_EXPIRY_DAYS = 365;

function formatDate(value: string | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function CreatedTokenCard({ token, onDismiss }: { token: string; onDismiss: () => void }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      toast.show({ tone: "success", title: "Copied to clipboard" });
    } catch {
      toast.show({ tone: "error", title: "Couldn't copy", message: "Select and copy it manually." });
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-card bg-tint-soft p-4">
      <p className="text-subheadline font-semibold text-tint-ink">
        Copy your token now — it won&apos;t be shown again.
      </p>
      <code className="break-all rounded-control bg-background px-3 py-2 text-footnote text-label">
        {token}
      </code>
      <div className="flex gap-2">
        <Button size="sm" variant="tinted" onClick={() => void handleCopy()}>
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button size="sm" variant="plain" onClick={onDismiss}>
          Done
        </Button>
      </div>
    </div>
  );
}

function TokenRow({ token, onRevoke }: { token: PersonalAccessToken; onRevoke: (id: string) => void }) {
  const [revoking, setRevoking] = useState(false);
  const revoked = token.revokedAt !== null;

  async function handleRevoke() {
    setRevoking(true);
    try {
      await revokeToken(token.id);
      onRevoke(token.id);
    } finally {
      setRevoking(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-control border border-control-border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1">
        <p className="text-subheadline font-semibold text-label">{token.name}</p>
        <div className="flex flex-wrap gap-1.5">
          {token.scopes.map((scope) => (
            <Badge key={scope} tone="tint">
              {scope}
            </Badge>
          ))}
          {revoked ? <Badge tone="danger">Revoked</Badge> : null}
        </div>
        <p className="text-footnote text-label-secondary">
          Expires {formatDate(token.expiresAt)} · Last used {formatDate(token.lastUsedAt)}
        </p>
      </div>
      {revoked ? null : (
        <Button
          size="sm"
          variant="destructive"
          loading={revoking}
          onClick={() => void handleRevoke()}
          className="self-start sm:self-center"
        >
          Revoke
        </Button>
      )}
    </div>
  );
}

export function PersonalAccessTokens() {
  const { data, loading, error, reload } = useApi(() => listTokens(), []);
  const [tokens, setTokens] = useState<PersonalAccessToken[] | null>(null);

  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<TokenScope[]>([]);
  const [expiresInDays, setExpiresInDays] = useState(String(DEFAULT_EXPIRY_DAYS));
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  const items = tokens ?? data?.items ?? [];

  const toggleScope = useCallback((scope: TokenScope, checked: boolean) => {
    setScopes((prev) => (checked ? [...prev, scope] : prev.filter((s) => s !== scope)));
  }, []);

  async function handleCreate() {
    setCreateError(null);
    const days = Number(expiresInDays);
    if (!name.trim()) {
      setCreateError("Give the token a name, e.g. \"My laptop\".");
      return;
    }
    if (scopes.length === 0) {
      setCreateError("Pick at least one scope.");
      return;
    }
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      setCreateError("Expiry must be between 1 and 365 days.");
      return;
    }
    setCreating(true);
    try {
      const created = await createToken({ name: name.trim(), scopes, expiresInDays: days });
      setTokens([{ ...created, token: undefined } as PersonalAccessToken, ...items]);
      setCreatedToken(created.token);
      setName("");
      setScopes([]);
      setExpiresInDays(String(DEFAULT_EXPIRY_DAYS));
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Could not create the token.");
    } finally {
      setCreating(false);
    }
  }

  function handleRevoke(id: string) {
    setTokens(
      items.map((t) => (t.id === id ? { ...t, revokedAt: new Date().toISOString() } : t)),
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-card bg-grouped-secondary p-4 shadow-card">
      <div>
        <h2 className="text-headline text-label">Personal access tokens</h2>
        <p className="text-body text-label-secondary">
          Let your own Claude (via <code>apps/mcp</code>) read your feed and manage your
          applications. Pick only the scopes you need.
        </p>
      </div>

      {createdToken ? (
        <CreatedTokenCard token={createdToken} onDismiss={() => setCreatedToken(null)} />
      ) : null}

      <div className="flex flex-col gap-3">
        <TextField
          label="Name"
          placeholder="e.g. My laptop"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="flex flex-col gap-2">
          <span className="text-subheadline font-medium text-label">Scopes</span>
          {SCOPES.map((scope) => (
            <label key={scope.value} className="flex items-center justify-between gap-3">
              <span>
                <span className="block text-body text-label">{scope.label}</span>
                <span className="block text-footnote text-label-secondary">{scope.hint}</span>
              </span>
              <Toggle
                label={scope.label}
                checked={scopes.includes(scope.value)}
                onChange={(checked) => toggleScope(scope.value, checked)}
              />
            </label>
          ))}
        </div>
        <TextField
          label="Expires in (days)"
          type="number"
          min={1}
          max={365}
          value={expiresInDays}
          onChange={(e) => setExpiresInDays(e.target.value)}
        />
        {createError ? (
          <p role="alert" className="text-footnote text-danger-ink">
            {createError}
          </p>
        ) : null}
        <Button onClick={() => void handleCreate()} loading={creating} className="self-start">
          Create token
        </Button>
      </div>

      {loading ? (
        <div aria-busy="true" aria-label="Loading your tokens" className="flex justify-center py-4">
          <Spinner label="Loading" />
        </div>
      ) : error ? (
        <EmptyState
          tone="error"
          illustration="error"
          title="We couldn't load your tokens"
          action={
            <Button size="sm" variant="gray" onClick={reload}>
              Try again
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <p className="text-footnote text-label-secondary">No tokens yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((token) => (
            <TokenRow key={token.id} token={token} onRevoke={handleRevoke} />
          ))}
        </div>
      )}
    </section>
  );
}
