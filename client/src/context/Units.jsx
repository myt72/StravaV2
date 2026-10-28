import { createContext, useCallback, useContext, useMemo } from "react";
import { IMPERIAL, unitsFor } from "../lib/units.js";
import { usePersistentState } from "../lib/storage.js";

const UnitsContext = createContext({ ...IMPERIAL, setSystem: () => {} });

/** Imperial/Metric display preference (default imperial), persisted as stravaV2:unitSystem. */
export function UnitsProvider({ children }) {
  const [stored, setStored] = usePersistentState("unitSystem", "imperial");
  const system = stored === "metric" ? "metric" : "imperial";
  const setSystem = useCallback(v => setStored(v === "metric" ? "metric" : "imperial"), [setStored]);
  const value = useMemo(() => ({ ...unitsFor(system), setSystem }), [system, setSystem]);
  return <UnitsContext.Provider value={value}>{children}</UnitsContext.Provider>;
}

export const useUnits = () => useContext(UnitsContext);
