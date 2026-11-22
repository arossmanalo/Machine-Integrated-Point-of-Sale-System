// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import journal from './meta/_journal.json';
import m0000 from './0000_init.sql';
import m0001 from './0001_inventory_add_on_flag.sql';
import m0002 from './0002_machine_pulses_and_assignment.sql';
import m0003 from './0003_machine_runs_and_top_ups.sql';
import m0004 from './0004_order_receipt_codes.sql';
import m0005 from './0005_expense_recorded_by.sql';
import m0006 from './0006_top_up_lengths.sql';
import m0007 from './0007_prepaid_top_ups.sql';

  export default {
    journal,
    migrations: {
      m0000,
m0001,
m0002,
m0003,
m0004,
m0005,
m0006,
m0007
    }
  }
  