import { createContext, useContext } from "react";

export const AccessContext = createContext(null);

export function useAccess() {
  return useContext(AccessContext);
}
