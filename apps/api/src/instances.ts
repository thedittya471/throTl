export function readInstances(env: NodeJS.ProcessEnv = process.env) {
  const instanceId = env.INSTANCE_ID ?? 'local';
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(instanceId)) throw new Error('Invalid INSTANCE_ID');
  const peers = env.INSTANCE_PEERS ? env.INSTANCE_PEERS.split(',') : [];
  if (peers.length !== 0 && peers.length !== 2) throw new Error('INSTANCE_PEERS must contain two HTTP origins');
  for (const peer of peers) {
    const url = new URL(peer);
    if (url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.origin !== peer) {
      throw new Error('INSTANCE_PEERS must contain HTTP origins without credentials or paths');
    }
  }
  if (new Set(peers).size !== peers.length) throw new Error('Duplicate instance origins');
  const secret = env.INSTANCE_SECRET;
  if ((peers.length || secret !== undefined) && (!secret || !/^[a-f0-9]{64}$/.test(secret))) {
    throw new Error('INSTANCE_SECRET must be 64 hexadecimal characters');
  }
  return { instanceId, peers, ...(secret === undefined ? {} : { secret }) };
}
export type InstanceOptions = ReturnType<typeof readInstances>;
