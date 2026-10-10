const messages = {
  'collaboration.title': 'Live collaboration',
  'collaboration.intro':
    'Work on one diagram together. The owner approves every device; diagram content is encrypted between participants.',
  'collaboration.unavailable':
    'The collaboration relay is not configured. Your local workspace works normally. An administrator must configure the relay before rooms can be created or joined.',
  'collaboration.selectDiagram': 'Open a diagram before creating a room.',
  'collaboration.displayName': 'Your display name',
  'collaboration.nameHint':
    'Names are chosen by participants, not verified company identities. Check the device fingerprint through a trusted channel.',
  'collaboration.create': 'Create a room',
  'collaboration.join': 'Join a room',
  'collaboration.invitation': 'Private invitation link',
  'collaboration.inviteHint':
    'Treat this one-use, expiring link as a secret. The owner still needs to approve the joining device.',
  'collaboration.coreScope':
    'Shares this diagram’s nodes, connections, text, descriptions, notes and simulation model. Other diagrams, passwords and workspace settings stay local.',
  'collaboration.scopeTitle': 'Include additional information',
  'collaboration.metadata': 'Custom metadata and integration IDs',
  'collaboration.owners': 'Assigned owners and their details',
  'collaboration.datasets': 'Raw datasets and CSV analysis data',
  'collaboration.shareConsent':
    'I have reviewed the diagram and am allowed to share this information.',
  'collaboration.createAction': 'Start private room',
  'collaboration.joinAction': 'Request to join',
  'collaboration.securityTitle': 'Before you share',
  'collaboration.securityBody':
    'The relay sees connection and membership metadata, not diagram content or encryption keys. Participants can keep copies. Encryption does not protect an unlocked, compromised browser.',
  'collaboration.reloadWarning':
    'Live encryption keys stay in memory. Reloading or locking ends your local session. Owners create a new room; other participants need a fresh invitation and approval.',
  'collaboration.backupWarning':
    'Removing a participant or changing a password cannot revoke screenshots, exports, backups or information already copied.',
  'collaboration.joinWarning':
    'Check the invitation and owner through a trusted channel. Joining creates a separate local diagram; your other diagrams are not shared.',
  'collaboration.copy': 'Copy private invitation',
  'collaboration.copied': 'Invitation copied. Share it through a private, trusted channel.',
  'collaboration.copyFailed': 'The browser could not copy the link. Select and copy it manually.',
  'collaboration.newInvitation': 'Create one-use invitation',
  'collaboration.expires': 'Expires: {date}',
  'collaboration.participants': 'People in this room',
  'collaboration.pending': 'Waiting for your approval',
  'collaboration.fingerprint': 'Device fingerprint',
  'collaboration.compareFingerprint':
    'Compare this complete fingerprint with the person through a trusted channel before approving.',
  'collaboration.approve': 'Approve device',
  'collaboration.reject': 'Reject request',
  'collaboration.role': 'Permission',
  'collaboration.role.owner': 'Owner',
  'collaboration.role.editor': 'Editor',
  'collaboration.role.viewer': 'Viewer',
  'collaboration.roleHint':
    'Editors change the shared diagram. Viewers read it. Only the owner admits devices and changes permissions.',
  'collaboration.self': 'You',
  'collaboration.online': 'Connected',
  'collaboration.offline': 'Disconnected',
  'collaboration.selected': 'Selected nodes: {count}',
  'collaboration.agent': 'MCP agent',
  'collaboration.remove': 'Remove participant',
  'collaboration.leave': 'Leave room',
  'collaboration.closeRoom': 'Close room for everyone',
  'collaboration.confirmTitle': 'Confirm room change',
  'collaboration.confirmRemove':
    'Remove {name}? This device loses access to future room messages. Copies already received cannot be recalled.',
  'collaboration.confirmChangeRole':
    'Change {name} to {role}? The new permission applies to future actions in this room.',
  'collaboration.confirmReject':
    'Reject this device’s request? It will need a new invitation to try again.',
  'collaboration.confirmLeave':
    'Leave this live room? Your saved local diagram remains. Returning requires a fresh invitation and approval.',
  'collaboration.confirmClose':
    'Close the room for everyone? All participants are disconnected. Saved local diagrams and copies remain.',
  'collaboration.confirm': 'Confirm change',
  'collaboration.cancel': 'Cancel',
  'collaboration.busy': 'Working…',
  'collaboration.reconnect': 'Reconnect live session',
  'collaboration.errorTitle': 'Collaboration needs attention',
  'collaboration.syncProgress': 'Syncing: {completed} of {total} parts',
  'collaboration.status.idle': 'Local workspace',
  'collaboration.status.connecting': 'Connecting',
  'collaboration.status.awaiting-approval': 'Waiting for owner approval',
  'collaboration.status.syncing': 'Synchronizing diagram',
  'collaboration.status.live': 'Live',
  'collaboration.status.offline': 'Offline · live sync paused',
  'collaboration.status.conflict': 'Changes need review · sync paused',
  'collaboration.status.error': 'Connection needs attention',
  'collaboration.sharing': 'Included in this room',
  'collaboration.room': 'Room: {id}',
  'collaboration.ownerFingerprint': 'Owner device fingerprint',
  'collaboration.selfFingerprint': 'Your device fingerprint',
  'collaboration.selfFingerprintHint':
    'Share this complete fingerprint with the owner through a separate trusted channel before approval.',
  'collaboration.recoveryCopy':
    'Your unsent changes were kept in a local recovery diagram: “{name}”. Find it in {projects}. This shared diagram now follows the owner’s current version.',
  'collaboration.open': 'Open collaboration and participants',
  'collaboration.action': 'Collaboration',
  'collaboration.requiresEncryption':
    'Live collaboration requires the encrypted app workspace. You can keep editing your local diagrams here. Opening the encrypted app does not move or share your existing diagrams.',
  'collaboration.openEncryptedApp': 'Open the encrypted app',
  'collaboration.connectedCount': '{count} connected',
  'collaboration.copyValue': 'Copy {label}',
  'collaboration.copyHint': 'Click or tap to copy.',
  'collaboration.valueCopied': 'Copied to clipboard.',
  'collaboration.valueCopyFailed': 'Could not copy. Select the value and copy it manually.',
  'collaboration.deviceId': 'Device ID',
  'collaboration.roomId': 'Room ID',
} as const;

export default messages;
export type CollaborationMessages = Record<keyof typeof messages, string>;
