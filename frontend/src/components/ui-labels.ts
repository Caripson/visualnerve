/** Display keys only: selected/persisted values remain the canonical model enums. */
export const ownerKindKeys = {
  person: 'dialogs.ownerKindPerson',
  team: 'dialogs.ownerKindTeam',
  department: 'dialogs.ownerKindDepartment',
  system: 'dialogs.ownerKindSystem',
  organization: 'dialogs.ownerKindOrganization',
  external: 'dialogs.ownerKindExternal',
} as const;

export const timelineScaleKeys = {
  day: 'toolbar.timelineDay',
  week: 'toolbar.timelineWeek',
  month: 'toolbar.timelineMonth',
  quarter: 'toolbar.timelineQuarter',
  year: 'toolbar.timelineYear',
} as const;
