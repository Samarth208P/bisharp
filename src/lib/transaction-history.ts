import type { Hash } from "viem";

export type TrackedTransaction = {
  hash: Hash;
  chainId: number;
  label: string;
  state: "pending" | "confirmed" | "failed";
  messages: Hash[];
};

const LIMIT = 12;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const isHash = (value: unknown): value is Hash =>
  typeof value === "string" && HASH.test(value);
const identity = (tx: Pick<TrackedTransaction, "chainId" | "hash">) =>
  `${tx.chainId}:${tx.hash.toLowerCase()}`;

function uniqueMessages(messages: readonly Hash[]): Hash[] {
  const seen = new Set<string>();
  const result: Hash[] = [];
  for (const message of messages) {
    const key = message.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(message);
    if (result.length === LIMIT) break;
  }
  return result;
}

/** Restore only well-formed transactions belonging to this route's chains. */
export function parseTransactionHistory(
  value: unknown,
  chainIds: readonly number[],
): TrackedTransaction[] {
  if (!Array.isArray(value)) return [];
  const allowedChains = new Set(chainIds);
  const seen = new Set<string>();
  const result: TrackedTransaction[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const candidate = item as Record<string, unknown>;
    if (
      !isHash(candidate.hash) ||
      typeof candidate.chainId !== "number" ||
      !Number.isSafeInteger(candidate.chainId) ||
      candidate.chainId <= 0 ||
      !allowedChains.has(candidate.chainId) ||
      typeof candidate.label !== "string" ||
      candidate.label.length > 160 ||
      candidate.label.trim().length === 0 ||
      (candidate.state !== "pending" &&
        candidate.state !== "confirmed" &&
        candidate.state !== "failed") ||
      !Array.isArray(candidate.messages) ||
      !candidate.messages.every(isHash)
    ) {
      continue;
    }
    const tx: TrackedTransaction = {
      hash: candidate.hash,
      chainId: candidate.chainId,
      label: candidate.label.trim(),
      state: candidate.state,
      messages: uniqueMessages(candidate.messages),
    };
    const key = identity(tx);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tx);
    if (result.length === LIMIT) break;
  }
  return result;
}

/** Newest first; a receipt update replaces its pending entry without losing IDs. */
export function mergeTransactionHistory(
  previous: readonly TrackedTransaction[],
  tx: TrackedTransaction,
): TrackedTransaction[] {
  const key = identity(tx);
  const existing = previous.find((item) => identity(item) === key);
  const updated: TrackedTransaction = {
    ...tx,
    messages: uniqueMessages([...tx.messages, ...(existing?.messages ?? [])]),
  };
  const result = [updated];
  const seen = new Set([key]);
  for (const item of previous) {
    const itemKey = identity(item);
    if (seen.has(itemKey)) continue;
    seen.add(itemKey);
    result.push({ ...item, messages: uniqueMessages(item.messages) });
    if (result.length === LIMIT) break;
  }
  return result;
}

/** A successful replacement receipt does not necessarily execute our action. */
export function receiptTransaction(
  original: TrackedTransaction,
  receipt: { transactionHash: Hash; status: "success" | "reverted" },
  reason?: "repriced" | "replaced" | "cancelled",
): { transaction: TrackedTransaction; actionSucceeded: boolean } {
  return {
    transaction: {
      ...original,
      hash: receipt.transactionHash,
      label:
        reason === "cancelled"
          ? "Wallet cancellation"
          : reason === "replaced"
            ? "Replacement transaction · inspect details"
            : original.label,
      state: receipt.status === "success" ? "confirmed" : "failed",
      messages: [...original.messages],
    },
    actionSucceeded:
      receipt.status === "success" &&
      (reason === undefined || reason === "repriced"),
  };
}
