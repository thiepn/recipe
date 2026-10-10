import { z } from 'zod';

/**
 * A UI contract, NOT an authorization grant. Every future real household
 * operation must be reauthorized in the verified Core Gateway and database.
 */
export const householdRoleSchema = z.enum(['owner', 'editor', 'viewer']);
export const householdActionSchema = z.enum([
  'recipe.read', 'recipe.edit', 'invite.prepare', 'invite.send',
  'member.revoke', 'household.delete', 'planning.read', 'planning.write',
]);
export const membershipStatusSchema = z.enum(['active', 'revoked', 'pending']);
export type HouseholdRole = z.infer<typeof householdRoleSchema>;
export type HouseholdAction = z.infer<typeof householdActionSchema>;
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

export const inviteDraftSchema = z.object({
  email: z.string().trim().email().max(254).refine(
    s => !/[\u0000-\u001f\u007f]/.test(s) && s.split('@').length === 2,
    'Invalid invitation address',
  ),
  role: z.enum(['viewer', 'editor']),
}).strict();
export type HouseholdInviteDraft = z.infer<typeof inviteDraftSchema>;

export function prepareHouseholdInvite(value: unknown): HouseholdInviteDraft {
  const parsed = inviteDraftSchema.parse(value);
  return { email: parsed.email.toLowerCase(), role: parsed.role };
}

/** Fail closed until a *server-verified* authorization system is qualified. */
export function householdMay(
  value: {
    actorId: string | null;
    ownerId: string | null;
    role: HouseholdRole | null;
    status: MembershipStatus | null;
    action: HouseholdAction;
    serverAuthorized: boolean;
  },
): boolean {
  if (!value.serverAuthorized || !value.actorId || !value.ownerId) return false;
  if (value.status !== 'active') return false;
  const isOwner = value.actorId === value.ownerId;
  if (value.role === 'owner') return isOwner;
  if (isOwner) return false; // A demoted/corrupt owner record must not silently inherit privileges.
  if (value.role === 'editor') return [
    'recipe.read', 'recipe.edit', 'planning.read', 'planning.write',
  ].includes(value.action);
  if (value.role === 'viewer') return [
    'recipe.read', 'planning.read',
  ].includes(value.action);
  return false;
}

export interface SharingQualification {
  serverGateway: boolean;
  databasePolicies: boolean;
  testedRevocation: boolean;
  independentAccounts: boolean;
  operatorApproved: boolean;
}
export const NEVER_QUALIFIED: Readonly<SharingQualification> = Object.freeze({
  serverGateway: false,
  databasePolicies: false,
  testedRevocation: false,
  independentAccounts: false,
  operatorApproved: false,
});

export function sharingCanActivate(input: SharingQualification): boolean {
  return input.serverGateway && input.databasePolicies && input.testedRevocation &&
    input.independentAccounts && input.operatorApproved;
}

/** Changes to this matrix do not authorize anything until Core enforces it. */
export const ROLE_DESCRIPTION: Record<HouseholdRole, string> = {
  owner: 'Owner: manages membership and remains the sole authority for invitations and revocation.',
  editor: 'Editor: may edit household recipes and meal plans only after server authorization.',
  viewer: 'Viewer: may read approved household recipes and plans only after server authorization.',
};
