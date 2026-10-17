import type { Config } from '@react-router/dev/config';

export default {
  ssr: false,
  routeDiscovery: {
    mode: 'initial',
  },
} satisfies Config;
