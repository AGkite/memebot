export const NETWORKS = [
  { id: "solana", label: "Solana" },
  { id: "base", label: "Base" },
  { id: "eth", label: "Ethereum" },
  { id: "bsc", label: "BSC" },
] as const;

export type NetworkId = (typeof NETWORKS)[number]["id"];

export function isNetworkId(value: string): value is NetworkId {
  return NETWORKS.some((network) => network.id === value);
}

export function networkLabel(id: string): string {
  return NETWORKS.find((network) => network.id === id)?.label ?? id;
}

export function validPoolAddress(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(value) || /^0x[a-fA-F0-9]{40}$/.test(value);
}
