import { useEffect, useState } from 'react';

export default function useServerPort() {
  const [port, setPort] = useState<number | null>(null);
  useEffect(() => {
    if (typeof window.GOTPoll !== 'undefined') {
      window.GOTPoll.getServerPort().then(setPort);
    }
  }, []);
  return port;
}
