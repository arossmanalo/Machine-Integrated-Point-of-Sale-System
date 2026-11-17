import { createTestContext } from '@/db/testing';

import {
  addStaff,
  changeOwnerPin,
  checkOwnerPin,
  completeFirstRunSetup,
  listStaff,
  logIn,
  logOut,
  needsFirstRunSetup,
  removeStaff,
  restoreSession,
  updateStaff,
} from '../auth';
import { getSetting } from '../settings';

async function ownerContext() {
  const ctx = createTestContext();
  const owner = await completeFirstRunSetup(ctx, {
    username: 'Aryl',
    password: 'secret123',
    pin: '2468',
  });
  return { ctx, owner };
}

describe('first run and login', () => {
  it('requires setup once, then logs in case-insensitively and restores the session', async () => {
    const ctx = createTestContext();
    expect(needsFirstRunSetup(ctx)).toBe(true);
    await expect(
      completeFirstRunSetup(ctx, { username: 'Aryl', password: '123', pin: '2468' }),
    ).rejects.toThrow('6 characters');
    await completeFirstRunSetup(ctx, { username: 'Aryl', password: 'secret123', pin: '2468' });
    expect(needsFirstRunSetup(ctx)).toBe(false);

    await expect(logIn(ctx, 'aryl', 'wrong-pass')).rejects.toThrow('Incorrect');
    const actor = await logIn(ctx, ' ARYL ', 'secret123');
    expect(actor.role).toBe('OWNER');
    expect(restoreSession(ctx)?.id).toBe(actor.id);
    logOut(ctx);
    expect(restoreSession(ctx)).toBeNull();
  });

  it('never stores the password or PIN in plain text', async () => {
    const { ctx } = await ownerContext();
    const stored = listStaff(ctx)[0].passwordHash ?? '';
    expect(stored).not.toContain('secret123');
    expect(getSetting(ctx.db, 'ownerPinHash')).not.toContain('2468');
  });
});

describe('staff management', () => {
  it('follows the owner/admin role rules', async () => {
    const { ctx, owner } = await ownerContext();
    const adminId = await addStaff(ctx, owner, { username: 'Bea', password: 'bea12345', role: 'ADMIN' });
    const admin = { id: adminId, username: 'Bea', role: 'ADMIN' as const };
    await expect(
      addStaff(ctx, admin, { username: 'Cid', password: 'cid12345', role: 'ADMIN' }),
    ).rejects.toThrow('role');
    const employeeId = await addStaff(ctx, admin, {
      username: 'Cid',
      password: 'cid12345',
      role: 'EMPLOYEE',
    });
    await expect(
      addStaff(ctx, owner, { username: 'cid', password: 'x1234567', role: 'EMPLOYEE' }),
    ).rejects.toThrow('taken');
    await expect(
      updateStaff(ctx, admin, owner.id, { username: 'Aryl', password: '', role: 'OWNER' }),
    ).rejects.toThrow('cannot edit');
    expect(() => removeStaff(ctx, owner, owner.id)).toThrow();

    removeStaff(ctx, admin, employeeId);
    expect(listStaff(ctx).map((u) => u.username)).toEqual(['Aryl', 'Bea']);
    await expect(logIn(ctx, 'Cid', 'cid12345')).rejects.toThrow('Incorrect');
  });

  it('keeps the old password when editing without a new one', async () => {
    const { ctx, owner } = await ownerContext();
    const id = await addStaff(ctx, owner, { username: 'Dee', password: 'dee12345', role: 'EMPLOYEE' });
    await updateStaff(ctx, owner, id, { username: 'Dee R', password: '', role: 'EMPLOYEE' });
    await expect(logIn(ctx, 'Dee R', 'dee12345')).resolves.toMatchObject({ id });
  });
});

describe('owner PIN', () => {
  it('locks after five wrong tries and unlocks five minutes later', async () => {
    const { ctx } = await ownerContext();
    for (let i = 0; i < 4; i += 1) await expect(checkOwnerPin(ctx, '0000')).resolves.toBe('wrong');
    await expect(checkOwnerPin(ctx, '0000')).resolves.toBe('locked');
    await expect(checkOwnerPin(ctx, '2468')).resolves.toBe('locked');
    ctx.advance(5 * 60 * 1000);
    await expect(checkOwnerPin(ctx, '2468')).resolves.toBe('ok');
  });

  it('can be changed by the owner with the current PIN', async () => {
    const { ctx, owner } = await ownerContext();
    await expect(changeOwnerPin(ctx, owner, '1111', '1357')).rejects.toThrow('wrong');
    await changeOwnerPin(ctx, owner, '2468', '1357');
    await expect(checkOwnerPin(ctx, '1357')).resolves.toBe('ok');
  });
});
