import type { EIP1193Provider } from "viem";
type InjectedProvider = EIP1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (
    event: string,
    listener: (...args: unknown[]) => void,
  ) => void;
};
declare global {
  interface Window {
    ethereum?: InjectedProvider;
  }
}
