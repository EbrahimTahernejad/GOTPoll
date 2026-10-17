import { Client } from 'tmi.js';
import type { SessionContext } from '../supervisor.js';
import type { Deliver } from './types.js';

const JOIN_TIMEOUT_MS = 20_000;
const FATAL_NOTICES = new Set<string>(['msg_channel_suspended', 'tos_ban', 'msg_banned']);

/**
 * One Twitch IRC connection (anonymous, read-only). tmi.js' own reconnect is
 * off – the Supervisor owns retries so all platforms behave the same. tmi's
 * built-in PING/PONG (every 60s) still runs and closes a dead socket, which
 * ends this session.
 */
export function twitchSession(channel: string, deliver: Deliver) {
  const chan = channel.trim().replace(/^#/, '').toLowerCase();
  return (ctx: SessionContext) =>
    new Promise<void>((resolve, reject) => {
      if (!/^[a-z0-9_]{2,25}$/.test(chan)) {
        reject(new Error(`"${channel}" isn't a valid Twitch channel name`));
        return;
      }
      const client = new Client({
        channels: [chan],
        connection: { reconnect: false, secure: true, timeout: 10_000 },
        options: { skipUpdatingEmotesets: true, skipMembership: true },
        logger: { info: () => {}, warn: () => {}, error: () => {} },
      });
      let joined = false;
      let connected = false;
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(joinTimer);
        client.removeAllListeners();
        client.disconnect().catch(() => {});
        if (err) reject(err);
        else resolve();
      };
      const joinTimer = setTimeout(() => {
        if (joined) return;
        finish(
          new Error(connected ? `couldn't join #${chan} – check the channel name` : "can't reach Twitch")
        );
      }, JOIN_TIMEOUT_MS);

      client.on('connected', () => {
        connected = true;
        ctx.alive();
      });
      client.on('roomstate', () => {
        joined = true;
        ctx.live(`#${chan}`);
      });
      client.on('message', (_c, tags, message, self) => {
        ctx.alive();
        const userId = tags['user-id'];
        if (!self && userId) deliver({ platform: 'twitch', userId, text: message });
      });
      client.on('ping', ctx.alive);
      client.on('pong', ctx.alive);
      client.on('notice', (_c, msgid, message) => {
        if (FATAL_NOTICES.has(msgid)) {
          finish(new Error(message || msgid));
        }
      });
      client.on('disconnected', (reason) => finish(new Error(reason || 'disconnected')));
      ctx.signal.addEventListener('abort', () => finish(), { once: true });
      client.connect().catch((err: unknown) => finish(err instanceof Error ? err : new Error(String(err))));
    });
}
