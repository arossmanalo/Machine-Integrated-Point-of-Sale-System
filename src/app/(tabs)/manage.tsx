import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router, type Href } from 'expo-router';

import { can, type Role } from '@/domain/permissions';
import { useActor } from '@/state/AppProvider';
import { AppUpdatesSection } from '@/ui/AppUpdates';
import type { IconName } from '@/ui/Button';
import { ListRow, Panel, Screen, Section } from '@/ui/layout';
import { colors } from '@/ui/theme';

interface Link {
  href: Href;
  icon: IconName;
  title: string;
  subtitle: string;
  allowed: (role: Role) => boolean;
}

const LINKS: Link[] = [
  { href: '/manage/reports', icon: 'chart-box-outline', title: 'Reports and expenses', subtitle: 'Money in and out by day, month and year', allowed: can.viewReports },
  { href: '/manage/staff', icon: 'badge-account-outline', title: 'Staff', subtitle: 'Accounts, roles and passwords', allowed: can.manageStaff },
  { href: '/manage/settings', icon: 'tune-variant', title: 'Shop settings', subtitle: 'Price per load, statuses, receipt printer', allowed: can.changeSettings },
  { href: '/manage/machines', icon: 'washing-machine', title: 'Machines', subtitle: 'Machine list, channels, start pulses, owner PIN', allowed: can.manageMachines },
  { href: '/manage/unlock-log', icon: 'history', title: 'Machine log', subtitle: 'Every machine start, override and wrong PIN', allowed: can.viewUnlockLog },
  { href: '/manage/backup', icon: 'database-export-outline', title: 'Backup and import', subtitle: 'Save a copy of the data, restore, or bring in the old app', allowed: can.manageBackups },
];

export default function Manage() {
  const actor = useActor();
  const links = LINKS.filter((link) => link.allowed(actor.role));
  return (
    <Screen>
      <Section title="Manage the shop">
        <Panel>
          {links.map((link, index) => (
            <ListRow
              key={link.title}
              title={link.title}
              subtitle={link.subtitle}
              right={<MaterialCommunityIcons name={link.icon} size={24} color={colors.textMuted} />}
              onPress={() => router.push(link.href)}
              last={index === links.length - 1}
            />
          ))}
        </Panel>
      </Section>
      <AppUpdatesSection />
    </Screen>
  );
}
