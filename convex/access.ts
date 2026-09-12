import type { QueryCtx } from './_generated/server';

export async function identity(ctx: Pick<QueryCtx, 'auth'>) {
  const user = await ctx.auth.getUserIdentity();
  if (!user) throw new Error('Unauthenticated');
  return user;
}

export async function hashToken(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Unauthorized: invalid token');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function requireMember(ctx: QueryCtx, profileKey: string) {
  const user = await identity(ctx);
  const member = await ctx.db.query('memberships').withIndex('by_member', q => q.eq('profileKey', profileKey).eq('subject', user.tokenIdentifier)).unique();
  if (!member) throw new Error('Unauthorized');
  return member;
}

export async function requireMachine(ctx: QueryCtx, profileKey: string, token: string) {
  if (!token) throw new Error('Unauthorized');
  const tokenHash = await hashToken(token);
  const credential = await ctx.db.query('machineCredentials').withIndex('by_profile', q => q.eq('profileKey', profileKey)).unique();
  if (!credential || credential.tokenHash !== tokenHash) throw new Error('Unauthorized');
}

export async function requireReader(ctx: QueryCtx, profileKey: string, token?: string) {
  if (token !== undefined) await requireMachine(ctx, profileKey, token);
  else await requireMember(ctx, profileKey);
}
