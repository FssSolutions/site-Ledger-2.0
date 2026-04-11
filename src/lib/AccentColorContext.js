import { createContext, useContext } from 'react';

const AccentColorContext = createContext('#E8651A');

export function useAccentColor() {
  return useContext(AccentColorContext);
}

export default AccentColorContext;
