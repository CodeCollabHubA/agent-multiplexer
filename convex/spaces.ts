import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { v } from 'convex/values';
import { hashToken, identity, requireMember } from './access';

const profileArgs = { profileKey: v.string() };
function spaceName(name: string) {
  const value = name.trim();
  if (!value || value.length > 100) throw new Error('Name must contain 1–100 characters');
  return value;
}
async function getSpace(ctx: QueryCtx, profileKey: string) {
  const id = ctx.db.normalizeId('spaces', profileKey);
  const space = id ? await ctx.db.get(id) : null;
  if (!space) throw new Error('Workspace unavailable');
  return space;
}
async function clearRunner(ctx: MutationCtx, profileKey: string) {
  for (const table of ['machineStatus', 'terminalCommands'] as const) {
    for (const row of await ctx.db.query(table).withIndex('by_profile', q => q.eq('profileKey', profileKey)).collect()) await ctx.db.delete(row._id);
  }
}
export const list = query({ args: {}, handler: async ctx => {
  const user = await identity(ctx);
  const memberships = await ctx.db.query('memberships').withIndex('by_subject', q => q.eq('subject', user.tokenIdentifier)).collect();
  return Promise.all(memberships.map(async member => ({ profileKey: member.profileKey, name: (await getSpace(ctx, member.profileKey)).name })));
}});
export const create = mutation({ args: { name: v.string() }, handler: async (ctx, args) => {
  const user = await identity(ctx);
  const name = spaceName(args.name);
  const profileKey = await ctx.db.insert('spaces', { name, createdAt: Date.now() });
  await ctx.db.insert('memberships', { profileKey, subject: user.tokenIdentifier, name: user.name ?? user.nickname ?? 'Member', email: user.email });
  await ctx.db.insert('profiles', { profileKey, storeVersion: 1, workspaceOrder: [], updatedAt: Date.now() });
  return { profileKey, name };
}});
export const rename = mutation({ args: { ...profileArgs, name: v.string() }, handler: async (ctx, args) => {
  await requireMember(ctx, args.profileKey);
  await ctx.db.patch((await getSpace(ctx, args.profileKey))._id, { name: spaceName(args.name) });
  return null;
}});
export const members = query({ args: profileArgs, handler: async (ctx, args) => {
  const self = await requireMember(ctx, args.profileKey);
  const rows = await ctx.db.query('memberships').withIndex('by_profile', q => q.eq('profileKey', args.profileKey)).collect();
  return rows.map(row => ({ id: row._id, name: row.name, email: row.email ?? null, isSelf: row._id === self._id }));
}});
export const leave = mutation({ args: profileArgs, handler: async (ctx, args) => {
  const member = await requireMember(ctx, args.profileKey);
  const rows = await ctx.db.query('memberships').withIndex('by_profile', q => q.eq('profileKey', args.profileKey)).take(2);
  if (rows.length < 2) throw new Error('The last member cannot leave');
  await ctx.db.delete(member._id);
  return null;
}});
export const createInvite = mutation({ args: { ...profileArgs, token: v.string() }, handler: async (ctx, args) => {
  await requireMember(ctx, args.profileKey);
  const tokenHash = await hashToken(args.token);
  if (await ctx.db.query('invitations').withIndex('by_token', q => q.eq('tokenHash', tokenHash)).unique()) throw new Error('Generate a new invitation token');
  const createdAt = Date.now();
  const expiresAt = createdAt + 7 * 24 * 60 * 60 * 1000;
  const id = await ctx.db.insert('invitations', { profileKey: args.profileKey, tokenHash, createdAt, expiresAt });
  return { id, expiresAt };
}});
export const invites = query({ args: profileArgs, handler: async (ctx, args) => {
  await requireMember(ctx, args.profileKey);
  const rows = await ctx.db.query('invitations').withIndex('by_profile', q => q.eq('profileKey', args.profileKey)).collect();
  return rows.filter(row => row.consumedAt === undefined && row.revokedAt === undefined && row.expiresAt > Date.now()).map(row => ({ id: row._id, expiresAt: row.expiresAt, createdAt: row.createdAt }));
}});
export const revokeInvite = mutation({ args: { ...profileArgs, id: v.id('invitations') }, handler: async (ctx, args) => {
  await requireMember(ctx, args.profileKey);
  const invite = await ctx.db.get(args.id);
  if (!invite || invite.profileKey !== args.profileKey) throw new Error('Invitation unavailable');
  await ctx.db.patch(invite._id, { revokedAt: Date.now() });
  return null;
}});
export const acceptInvite = mutation({ args: { token: v.string() }, handler: async (ctx, args) => {
  const user = await identity(ctx);
  const tokenHash = await hashToken(args.token);
  const invite = await ctx.db.query('invitations').withIndex('by_token', q => q.eq('tokenHash', tokenHash)).unique();
  if (!invite || invite.consumedAt !== undefined || invite.revokedAt !== undefined || invite.expiresAt <= Date.now()) throw new Error('Invitation expired or unavailable');
  const space = await getSpace(ctx, invite.profileKey);
  const member = await ctx.db.query('memberships').withIndex('by_member', q => q.eq('profileKey', invite.profileKey).eq('subject', user.tokenIdentifier)).unique();
  // Membership creation and consumption share one Convex transaction; racing acceptances retry and observe consumption.
  if (!member) await ctx.db.insert('memberships', { profileKey: invite.profileKey, subject: user.tokenIdentifier, name: user.name ?? user.nickname ?? 'Member', email: user.email });
  await ctx.db.patch(invite._id, { consumedAt: Date.now() });
  return { profileKey: invite.profileKey, name: space.name };
}});
export const pairMachine = mutation({ args: { ...profileArgs, token: v.string() }, handler: async (ctx, args) => {
  await requireMember(ctx, args.profileKey);
  const tokenHash = await hashToken(args.token);
  const row = await ctx.db.query('machineCredentials').withIndex('by_profile', q => q.eq('profileKey', args.profileKey)).unique();
  if (row) await ctx.db.patch(row._id, { tokenHash });
  else await ctx.db.insert('machineCredentials', { profileKey: args.profileKey, tokenHash });
  await clearRunner(ctx, args.profileKey);
  return null;
}});
export const revokeMachine = mutation({ args: profileArgs, handler: async (ctx, args) => {
  await requireMember(ctx, args.profileKey);
  const row = await ctx.db.query('machineCredentials').withIndex('by_profile', q => q.eq('profileKey', args.profileKey)).unique();
  if (row) await ctx.db.delete(row._id);
  await clearRunner(ctx, args.profileKey);
  return null;
}});
export const machine = query({ args: profileArgs, handler: async (ctx, args) => {
  await requireMember(ctx, args.profileKey);
  return { paired: !!await ctx.db.query('machineCredentials').withIndex('by_profile', q => q.eq('profileKey', args.profileKey)).unique() };
}});
