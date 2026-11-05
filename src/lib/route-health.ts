import { zeroAddress, type Address } from "viem";

export type PairingState = "ready" | "pending";

/** An unpaired deployment is pending setup; a wrong peer or lane is an error. */
export function inspectPairing({
  peer,
  expectedPeer,
  authority,
  local,
  remote,
  expectedLocal,
  expectedRemote,
}: {
  peer: Address;
  expectedPeer: Address;
  authority: Address;
  local: bigint;
  remote: bigint;
  expectedLocal: bigint;
  expectedRemote: bigint;
}): PairingState {
  if (local !== expectedLocal || remote !== expectedRemote) {
    throw new Error(
      "The contract network configuration does not match this route. Transactions are disabled.",
    );
  }
  if (peer.toLowerCase() === zeroAddress) {
    if (authority.toLowerCase() === zeroAddress) {
      throw new Error(
        "The contract has no paired counterpart or activation authority. Transactions are disabled.",
      );
    }
    return "pending";
  }
  if (peer.toLowerCase() !== expectedPeer.toLowerCase()) {
    throw new Error(
      "The contract is paired with a different counterpart. Transactions are disabled.",
    );
  }
  if (authority.toLowerCase() !== zeroAddress) {
    throw new Error(
      "Contract pairing has not been finalized. Transactions are disabled.",
    );
  }
  return "ready";
}

type Snapshot = { at: number; pairing: PairingState };

export function isFreshSnapshot(
  snapshot: Snapshot | undefined,
  error: string,
  now: number,
) {
  return Boolean(
    snapshot && !error && now >= snapshot.at && now - snapshot.at < 45_000,
  );
}

export function canUseRouteSide(
  snapshot: Snapshot | undefined,
  error: string,
  now: number,
) {
  return snapshot?.pairing === "ready" && isFreshSnapshot(snapshot, error, now);
}
