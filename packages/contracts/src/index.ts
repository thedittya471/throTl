export const CONTRACT_VERSION = 1;

export type HealthResponse = {
  version: typeof CONTRACT_VERSION;
  status: 'ok';
  service: 'ratelab-api';
};

export function parseHealthResponse(input: unknown): HealthResponse {
  if (typeof input !== 'object' || input === null ||
      !('version' in input) || input.version !== CONTRACT_VERSION ||
      !('status' in input) || input.status !== 'ok' ||
      !('service' in input) || input.service !== 'ratelab-api') {
    throw new Error('Unsupported API health response');
  }
  return { version: CONTRACT_VERSION, status: 'ok', service: 'ratelab-api' };
}
