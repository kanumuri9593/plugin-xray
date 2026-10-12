// Switches for locked-down machines. Read at call time so a flag or env set
// by the CLI, a hook or a managed settings file applies everywhere.
//   XRAY_OFFLINE=1   never touch the network and never start other programs:
//                    scan local folders only; no --deep, no --tools.
//   XRAY_USAGE=off   do not read Claude Code session logs for last-used data.
const on = (v) => /^(1|true|yes|on)$/i.test(v || '');
const off = (v) => /^(0|false|no|off)$/i.test(v || '');

export const offline = () => on(process.env.XRAY_OFFLINE);
export const usageAllowed = () => !off(process.env.XRAY_USAGE);

export function needsNetwork(what) {
  if (offline()) throw new Error(`${what} needs the network, and XRAY_OFFLINE is set. Scan a local folder or unpacked package instead.`);
}
