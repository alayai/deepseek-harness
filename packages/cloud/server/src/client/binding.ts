/** Wire validation for a server-owned, permanent conversation execution target. */
import { z } from 'zod'

const Binding = z.object({
  schemaVersion: z.literal(1), serverId: z.uuid().brand<'CloudServerId'>(),
  tenantId: z.uuid().brand<'CloudTenantId'>(), workspaceId: z.uuid().brand<'CloudWorkspaceId'>(),
  cloudSessionId: z.uuid().brand<'CloudSessionId'>(), runtimeId: z.uuid().brand<'CloudRuntimeId'>(),
  credentialRef: z.uuid().brand<'CloudCredentialId'>(), desktopId: z.uuid().brand<'CloudDesktopId'>().nullable(),
  bindingRevision: z.number().int().positive(), state: z.enum(['active', 'disabled']),
})

/** Safe binding metadata; model keys and desktop control keys are never included. */
export type CloudBinding = z.infer<typeof Binding>

/**
 * Validate both the wire shape and the expected server/session identity.
 * @param value - Untrusted binding response.
 * @param expected - Identity captured before the request, including deployment identity.
 * @returns The validated immutable execution target.
 */
export function readBinding(
  value: unknown, expected: { serverId: string; tenantId: string; workspaceId: string; sessionId: string },
): CloudBinding {
  const binding = Binding.parse(value)
  if (binding.serverId !== expected.serverId || binding.tenantId !== expected.tenantId
    || binding.workspaceId !== expected.workspaceId || binding.cloudSessionId !== expected.sessionId) throw new Error('BINDING_IDENTITY_MISMATCH')
  return binding
}
