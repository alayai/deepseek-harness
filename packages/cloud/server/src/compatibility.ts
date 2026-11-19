/** Login protocol contract; disabled execution features do not prevent identity or storage access. */
import { z } from 'zod'
import { CloudApiError } from './transport.ts'
import type { CloudValue } from './types.ts'

const compatibility = z.object({
  protocol: z.literal(1),
  client: z.object({ min: z.number().int().positive().max(1), max: z.number().int().min(1) }),
})

/** Refuse absent or incompatible API contracts before publishing cloud authority.
 * @param info - bounded server-info response.
 */
export function requireCloudProtocol(info: CloudValue): void {
  const parsed = z.object({ compatibility }).safeParse(info)
  if (!parsed.success) throw new CloudApiError('CLOUD_PROTOCOL_UNSUPPORTED', 409)
}
