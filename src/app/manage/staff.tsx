import { useState } from 'react';

import type { UserRow } from '@/db/schema';
import {
  assignableRoles,
  can,
  canDeleteAccount,
  canEditAccount,
  ROLE_LABELS,
  type Role,
} from '@/domain/permissions';
import { addStaff, listStaff, removeStaff, updateStaff } from '@/services/auth';
import { useActor } from '@/state/AppProvider';
import { useAction, useData } from '@/state/hooks';
import { useToast } from '@/state/toast';
import { Button } from '@/ui/Button';
import { Badge, Choice, Dialog } from '@/ui/controls';
import { ListRow, Notice, Panel, Screen, Section } from '@/ui/layout';
import { ManageScreen } from '@/ui/ManagerGate';
import { Text } from '@/ui/Text';
import { TextField } from '@/ui/TextField';

export default function Staff() {
  const actor = useActor();
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);
  const staff = useData(listStaff);
  return (
    <ManageScreen title="Staff" allowed={can.manageStaff}>
      <Screen>
        <Section
          title="Staff accounts"
          description="Everyone signs in with their own account, so orders and machine starts show who did them."
          action={<Button label="Add staff" icon="account-plus-outline" onPress={() => setEditing('new')} />}
        >
          <Panel>
            {staff.map((member, index) => (
              <ListRow
                key={member.id}
                title={member.username}
                subtitle={`${member.id}${member.passwordHash ? '' : ' · needs a password before signing in'}`}
                right={<Badge label={ROLE_LABELS[member.role]} tone={member.role === 'EMPLOYEE' ? 'neutral' : 'accent'} />}
                onPress={canEditAccount(actor, member) ? () => setEditing(member) : undefined}
                last={index === staff.length - 1}
              />
            ))}
          </Panel>
        </Section>
      </Screen>
      {editing && <StaffDialog member={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </ManageScreen>
  );
}

function StaffDialog({ member, onClose }: { member: UserRow | null; onClose: () => void }) {
  const actor = useActor();
  const action = useAction();
  const toast = useToast();
  const roles = assignableRoles(actor, member);
  const [username, setUsername] = useState(member?.username ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>(member?.role ?? roles[roles.length - 1] ?? 'EMPLOYEE');
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function save() {
    const input = { username, password, role };
    const result = await action.run(async (c) => {
      if (member) await updateStaff(c, actor, member.id, input);
      else await addStaff(c, actor, input);
    });
    if (result.ok) {
      toast(member ? 'Account updated' : `${username.trim()} can now sign in`);
      onClose();
    }
  }

  return (
    <Dialog
      visible
      title={member ? `Edit ${member.username}` : 'New staff account'}
      onClose={onClose}
      actions={
        <>
          {member && canDeleteAccount(actor, member) && (
            confirmRemove ? (
              <Button
                label="Yes, remove"
                kind="danger"
                onPress={async () => {
                  const result = await action.run((c) => removeStaff(c, actor, member.id));
                  if (result.ok) onClose();
                }}
              />
            ) : (
              <Button label="Remove" kind="danger" onPress={() => setConfirmRemove(true)} />
            )
          )}
          <Button label={member ? 'Save changes' : 'Create account'} onPress={save} busy={action.busy} />
        </>
      }
    >
      <TextField label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" />
      <TextField
        label={member ? 'New password (leave empty to keep)' : 'Password'}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        hint="At least 6 characters."
      />
      {roles.length > 0 ? (
        <Choice label="Role" value={role} onChange={setRole} options={roles.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
      ) : (
        <Text tone="muted">{`Role: ${ROLE_LABELS[role]} (cannot be changed here)`}</Text>
      )}
      {confirmRemove && <Notice tone="danger">They will no longer be able to sign in. Their past work keeps their name.</Notice>}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Dialog>
  );
}
