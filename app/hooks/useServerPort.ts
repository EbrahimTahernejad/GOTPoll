import { useEffect, useState } from 'react';

export default function useServerPort() {
  const [port, setPort] = useState<number | null>(null);
  useEffect(() => {
    if (window.navigator.userAgent.includes('Electron')) {
      window.GOTPoll.getServerPort().then(setPort);
    }
  }, []);
  return port;
}
