import { app } from 'electron';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { port, publicPort } from './server.js';
import { user } from './services.js';
import { TunnelManager } from './tunnel/manager.js';

// "Share" = the URLs the viewer page is reachable at: this PC, the local
// network, and – on demand – a public tunnel link.

export const tunnel = new TunnelManager(path.join(app.getPath('userData'), 'bin'), () => publicPort);

// virtual adapters (Docker, VMs, VPNs) aren't where a second PC or phone is
const VIRTUAL = /^(docker|br-|veth|vboxnet|vmnet|vEthernet|bridge|utun|tun|tap|wg|zt|tailscale|ham|llw|awdl)/i;

function lanUrls() {
  const out: string[] = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    if (VIRTUAL.test(name)) continue;
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal && !ni.address.startsWith('169.254.')) {
        out.push(`http://${ni.address}:${port}`);
      }
    }
  }
  return out;
}

export function shareInfo(): ShareInfo {
  return { localUrl: `http://localhost:${port}`, lanUrls: lanUrls(), tunnel: tunnel.status };
}

export function startTunnel() {
  const s = user.settings();
  return tunnel.start(s.tunnelProvider, s.ngrokToken);
}

export function stopTunnel() {
  return tunnel.stop();
}

export function autoStartTunnel() {
  if (user.settings().tunnelAutoStart) void startTunnel();
}
