import { describe, expect, it } from 'vitest';
import * as mux from '../../convex/mux';

// Exercise the registered production handlers; a DB access before authorization is a failure.
describe('relay authorization boundary', () => {
  for (const [name, endpoint] of Object.entries(mux)) {
    it(`${name} denies anonymous access before reading relay data`, async () => {
      const ctx = { auth: { getUserIdentity: async () => null }, db: { query: () => { throw new Error('UNGUARDED_DATABASE_ACCESS'); } } };
      await expect((endpoint as any)._handler(ctx, { profileKey: 'default' })).rejects.toThrow(/Unauthorized|Unauthenticated/);
    });
  }
});

import * as spaces from '../../convex/spaces';
import { hashToken } from '../../convex/access';

function database() {
  const rows = new Map<string, any>();
  let counter = 0;
  const db = {
    query(table: string) {
      const filters: [string, unknown][] = [];
      const builder: any = {
        withIndex(_name: string, cb: any) { const q: any = { eq(key: string, value: unknown) { filters.push([key, value]); return q; } }; cb(q); return builder; },
        order() { return builder; },
        async collect() { return [...rows.values()].filter(row => row._table === table && filters.every(([k, v]) => row[k] === v)); },
        async unique() { const found = await builder.collect(); if (found.length > 1) throw new Error('Duplicate'); return found[0] ?? null; },
        async take(n: number) { return (await builder.collect()).slice(0, n); },
      };
      return builder;
    },
    async insert(table: string, value: any) { const id = `${table}:${++counter}`; rows.set(id, { ...value, _id: id, _table: table }); return id; },
    async patch(id: string, value: any) { rows.set(id, { ...rows.get(id), ...value }); },
    async get(id: string) { return rows.get(id) ?? null; },
    async delete(id: string) { rows.delete(id); },
    normalizeId(table: string, id: string) { return id.startsWith(`${table}:`) ? id : null; },
  };
  return { db, rows, ctx: (subject: string | null) => ({ db, auth: { getUserIdentity: async () => subject ? { tokenIdentifier: subject, name: subject } : null } }) };
}
const call = (endpoint: any, ctx: any, args: any = {}) => endpoint._handler(ctx, args);
const tokenA = 'a'.repeat(43);
const tokenB = 'b'.repeat(43);

describe('shared workspace security', () => {
  it('guards every workspace endpoint for anonymous callers', async () => {
    const d = database();
    for (const endpoint of Object.values(spaces)) await expect(call(endpoint, d.ctx(null), { profileKey: 'default', token: tokenA })).rejects.toThrow('Unauthenticated');
  });
  it('isolates all relay endpoints across membership and runner credentials', async () => {
    const d = database();
    const a = await call(spaces.create, d.ctx('a'), { name: 'A' });
    const b = await call(spaces.create, d.ctx('b'), { name: 'B' });
    await call(spaces.pairMachine, d.ctx('a'), { ...a, token: tokenA });
    for (const endpoint of Object.values(mux)) await expect(call(endpoint, d.ctx('b'), { profileKey: a.profileKey })).rejects.toThrow('Unauthorized');
    for (const endpoint of Object.values(mux)) await expect(call(endpoint, d.ctx(null), { profileKey: b.profileKey, machineToken: tokenA })).rejects.toThrow(/Unauthorized|Unauthenticated/);
    await expect(call(mux.pullState, d.ctx('a'), { profileKey: 'default' })).rejects.toThrow('Unauthorized');
    expect((await call(spaces.list, d.ctx('a'))).map((s: any) => s.name)).toEqual(['A']);
  });
  it('accepts an invite once, grants shared access and hides hashes', async () => {
    const d = database();
    const a = await call(spaces.create, d.ctx('a'), { name: 'A' });
    await call(spaces.createInvite, d.ctx('a'), { ...a, token: tokenA });
    expect(JSON.stringify(await call(spaces.invites, d.ctx('a'), a))).not.toContain('tokenHash');
    expect(await call(spaces.acceptInvite, d.ctx('b'), { token: tokenA })).toEqual(a);
    await expect(call(spaces.acceptInvite, d.ctx('c'), { token: tokenA })).rejects.toThrow('unavailable');
    expect(await call(spaces.list, d.ctx('b'))).toEqual([a]);
    expect(await call(spaces.list, d.ctx('c'))).toEqual([]);
    expect(await call(spaces.invites, d.ctx('a'), a)).toEqual([]);
  });
  it('rejects revoked and expired invitations and cross-space revocation', async () => {
    const d = database();
    const a = await call(spaces.create, d.ctx('a'), { name: 'A' });
    const b = await call(spaces.create, d.ctx('b'), { name: 'B' });
    const invite = await call(spaces.createInvite, d.ctx('a'), { ...a, token: tokenA });
    await expect(call(spaces.revokeInvite, d.ctx('b'), { ...b, id: invite.id })).rejects.toThrow('unavailable');
    await call(spaces.revokeInvite, d.ctx('a'), { ...a, id: invite.id });
    await expect(call(spaces.acceptInvite, d.ctx('b'), { token: tokenA })).rejects.toThrow('unavailable');
    const expired = await call(spaces.createInvite, d.ctx('a'), { ...a, token: tokenB });
    await d.db.patch(expired.id, { expiresAt: Date.now() - 1 });
    await expect(call(spaces.acceptInvite, d.ctx('b'), { token: tokenB })).rejects.toThrow('expired');
  });
  it('hashes credentials, rotates and revokes them, and clears old commands/presence', async () => {
    const d = database();
    const a = await call(spaces.create, d.ctx('a'), { name: 'A' });
    await call(spaces.pairMachine, d.ctx('a'), { ...a, token: tokenA });
    expect(JSON.stringify([...d.rows.values()])).not.toContain(tokenA);
    expect(await hashToken(tokenA)).toHaveLength(64);
    await call(mux.enqueueCommands, d.ctx('a'), { ...a, commands: [{ commandId: '1', message: '{}', createdAt: 1 }] });
    expect(await call(mux.pendingCommands, d.ctx(null), { ...a, machineToken: tokenA })).toHaveLength(1);
    await d.db.insert('machineStatus', { profileKey: a.profileKey, lastSeen: 1 });
    await call(spaces.pairMachine, d.ctx('a'), { ...a, token: tokenB });
    await expect(call(mux.pendingCommands, d.ctx(null), { ...a, machineToken: tokenA })).rejects.toThrow('Unauthorized');
    expect(await call(mux.pendingCommands, d.ctx(null), { ...a, machineToken: tokenB })).toEqual([]);
    expect(await call(mux.getMachineStatus, d.ctx('a'), a)).toBeNull();
    await call(spaces.revokeMachine, d.ctx('a'), a);
    await expect(call(mux.pendingCommands, d.ctx(null), { ...a, machineToken: tokenB })).rejects.toThrow('Unauthorized');
    expect(await call(spaces.machine, d.ctx('a'), a)).toEqual({ paired: false });
  });
  it('last member cannot leave; departed members immediately lose access', async () => {
    const d = database();
    const a = await call(spaces.create, d.ctx('a'), { name: 'A' });
    await expect(call(spaces.leave, d.ctx('a'), a)).rejects.toThrow('last member');
    await call(spaces.createInvite, d.ctx('a'), { ...a, token: tokenA });
    await call(spaces.acceptInvite, d.ctx('b'), { token: tokenA });
    await call(spaces.leave, d.ctx('a'), a);
    await expect(call(mux.pullState, d.ctx('a'), a)).rejects.toThrow('Unauthorized');
    expect(await call(spaces.list, d.ctx('b'))).toEqual([a]);
  });
});

describe('workspace administration isolation', () => {
  it('rejects every profile-scoped administration operation for outsiders', async () => {
    const d = database();
    const a = await call(spaces.create, d.ctx('a'), { name: 'A' });
    for (const name of ['rename', 'members', 'leave', 'createInvite', 'invites', 'revokeInvite', 'pairMachine', 'revokeMachine', 'machine'] as const) {
      await expect(call(spaces[name], d.ctx('b'), { ...a, token: tokenA })).rejects.toThrow('Unauthorized');
    }
  });
  it('existing member acceptance consumes without duplicating membership', async () => {
    const d = database();
    const a = await call(spaces.create, d.ctx('a'), { name: 'A' });
    await call(spaces.createInvite, d.ctx('a'), { ...a, token: tokenA });
    await call(spaces.acceptInvite, d.ctx('a'), { token: tokenA });
    expect(await call(spaces.members, d.ctx('a'), a)).toHaveLength(1);
    await expect(call(spaces.acceptInvite, d.ctx('b'), { token: tokenA })).rejects.toThrow('unavailable');
  });
  it('runner cannot enqueue and output publication never persists credentials', async () => {
    const d = database();
    const a = await call(spaces.create, d.ctx('a'), { name: 'A' });
    await call(spaces.pairMachine, d.ctx('a'), { ...a, token: tokenA });
    await expect(call(mux.enqueueCommands, d.ctx(null), { ...a, machineToken: tokenA, commands: [] })).rejects.toThrow('Unauthenticated');
    await call(mux.publishEvent, d.ctx(null), { profileKey: a.profileKey, machineToken: tokenA, eventId: '1', message: '{}', createdAt: 1 });
    expect(JSON.stringify(await call(mux.realtimeEvents, d.ctx('a'), a))).not.toContain(tokenA);
  });
});
