import type { CollaborationMessages } from './en';
const messages = {
  'collaboration.title': 'Samarbeid i sanntid',
  'collaboration.intro':
    'Arbeid sammen i ett diagram. Eieren godkjenner hver enhet; innholdet krypteres mellom deltakerne.',
  'collaboration.unavailable':
    'Samarbeidsreléet er ikke konfigurert. Det lokale arbeidsområdet fungerer som vanlig. En administrator må konfigurere reléet før rom kan opprettes eller brukes.',
  'collaboration.selectDiagram': 'Åpne et diagram før du oppretter et rom.',
  'collaboration.displayName': 'Visningsnavnet ditt',
  'collaboration.nameHint':
    'Deltakerne velger navnene selv; de er ikke verifiserte bedriftsidentiteter. Kontroller enhetens fingeravtrykk gjennom en betrodd kanal.',
  'collaboration.create': 'Opprett et rom',
  'collaboration.join': 'Bli med i et rom',
  'collaboration.invitation': 'Privat invitasjonslenke',
  'collaboration.inviteHint':
    'Lenken er hemmelig, kan brukes én gang og utløper. Eieren må også godkjenne enheten som blir med.',
  'collaboration.coreScope':
    'Deler diagrammets noder, forbindelser, tekst, beskrivelser, notater og simuleringsmodell. Andre diagrammer, passord og arbeidsområdets innstillinger forblir lokale.',
  'collaboration.scopeTitle': 'Ta med ytterligere informasjon',
  'collaboration.metadata': 'Egne metadata og integrasjons-ID-er',
  'collaboration.owners': 'Tildelte ansvarlige og opplysningene deres',
  'collaboration.datasets': 'Rådatasett og CSV-analysedata',
  'collaboration.shareConsent':
    'Jeg har gjennomgått diagrammet og har lov til å dele denne informasjonen.',
  'collaboration.createAction': 'Start privat rom',
  'collaboration.joinAction': 'Be om å bli med',
  'collaboration.securityTitle': 'Før du deler',
  'collaboration.securityBody':
    'Reléet ser tilkoblings- og medlemsmetadata, ikke diagraminnhold eller krypteringsnøkler. Deltakere kan beholde kopier. Krypteringen beskytter ikke en ulåst, kompromittert nettleser.',
  'collaboration.reloadWarning':
    'Krypteringsnøklene for live-økten finnes bare i minnet. Omlasting eller låsing avslutter den lokale økten. Eieren oppretter et nytt rom; andre deltakere trenger en ny invitasjon og godkjenning.',
  'collaboration.backupWarning':
    'Fjerning av en deltaker eller endring av passordet kan ikke tilbakekalle skjermbilder, eksporter, sikkerhetskopier eller informasjon som allerede er kopiert.',
  'collaboration.joinWarning':
    'Kontroller invitasjonen og eieren gjennom en betrodd kanal. Tilkobling oppretter et eget lokalt diagram; de andre diagrammene dine deles ikke.',
  'collaboration.copy': 'Kopier privat invitasjon',
  'collaboration.copied': 'Invitasjonen er kopiert. Del den gjennom en privat, betrodd kanal.',
  'collaboration.copyFailed': 'Nettleseren kunne ikke kopiere lenken. Merk og kopier den manuelt.',
  'collaboration.newInvitation': 'Opprett engangsinvitasjon',
  'collaboration.expires': 'Utløper: {date}',
  'collaboration.participants': 'Deltakere i rommet',
  'collaboration.pending': 'Venter på din godkjenning',
  'collaboration.fingerprint': 'Enhetens fingeravtrykk',
  'collaboration.compareFingerprint':
    'Sammenlign hele fingeravtrykket med personen gjennom en betrodd kanal før du godkjenner.',
  'collaboration.approve': 'Godkjenn enheten',
  'collaboration.reject': 'Avvis forespørsel',
  'collaboration.role': 'Tillatelse',
  'collaboration.role.owner': 'Eier',
  'collaboration.role.editor': 'Redigerer',
  'collaboration.role.viewer': 'Leser',
  'collaboration.roleHint':
    'Redigerere endrer diagrammet. Lesere leser det. Bare eieren godkjenner enheter og endrer tillatelser.',
  'collaboration.self': 'Deg',
  'collaboration.online': 'Tilkoblet',
  'collaboration.offline': 'Frakoblet',
  'collaboration.selected': 'Valgte noder: {count}',
  'collaboration.agent': 'MCP-agent',
  'collaboration.remove': 'Fjern deltaker',
  'collaboration.leave': 'Forlat rommet',
  'collaboration.closeRoom': 'Lukk rommet for alle',
  'collaboration.confirmTitle': 'Bekreft endring i rommet',
  'collaboration.confirmRemove':
    'Fjerne {name}? Enheten mister tilgang til fremtidige meldinger. Allerede mottatte kopier kan ikke tilbakekalles.',
  'collaboration.confirmChangeRole':
    'Endre {name} til {role}? Tillatelsen gjelder fremtidige handlinger i rommet.',
  'collaboration.confirmReject':
    'Avvise enhetens forespørsel? Den trenger en ny invitasjon for å prøve igjen.',
  'collaboration.confirmLeave':
    'Forlate live-rommet? Det lagrede lokale diagrammet beholdes. Du trenger en ny invitasjon og godkjenning for å komme tilbake.',
  'collaboration.confirmClose':
    'Lukke rommet for alle? Alle deltakere kobles fra. Lagrede lokale diagrammer og kopier beholdes.',
  'collaboration.confirm': 'Bekreft endring',
  'collaboration.cancel': 'Avbryt',
  'collaboration.busy': 'Arbeider…',
  'collaboration.reconnect': 'Koble til live-økten på nytt',
  'collaboration.errorTitle': 'Samarbeidet krever oppmerksomhet',
  'collaboration.syncProgress': 'Synkroniserer: {completed} av {total} deler',
  'collaboration.status.idle': 'Lokalt arbeidsområde',
  'collaboration.status.connecting': 'Kobler til',
  'collaboration.status.awaiting-approval': 'Venter på eierens godkjenning',
  'collaboration.status.syncing': 'Synkroniserer diagrammet',
  'collaboration.status.live': 'Live',
  'collaboration.status.offline': 'Frakoblet · livesynkronisering pauset',
  'collaboration.status.conflict': 'Endringer må gjennomgås · synkronisering pauset',
  'collaboration.status.error': 'Tilkoblingen krever oppmerksomhet',
  'collaboration.sharing': 'Inkludert i rommet',
  'collaboration.room': 'Rom: {id}',
  'collaboration.ownerFingerprint': 'Eierenhetens fingeravtrykk',
  'collaboration.selfFingerprint': 'Enhetens fingeravtrykk',
  'collaboration.selfFingerprintHint':
    'Del hele fingeravtrykket med eieren gjennom en separat betrodd kanal før godkjenning.',
  'collaboration.recoveryCopy':
    'De usendte endringene dine er lagret i et lokalt gjenopprettingsdiagram: «{name}». Du finner det under {projects}. Det delte diagrammet følger nå eierens gjeldende versjon.',
  'collaboration.open': 'Åpne samarbeid og deltakere',
  'collaboration.action': 'Samarbeid',
  'collaboration.requiresEncryption':
    'Livesamarbeid krever arbeidsområdet i den krypterte appen. Du kan fortsette å redigere lokale diagrammer her. Å åpne den krypterte appen flytter eller deler ikke eksisterende diagrammer.',
  'collaboration.openEncryptedApp': 'Åpne den krypterte appen',
  'collaboration.connectedCount': '{count} tilkoblet',
} satisfies CollaborationMessages;
export default messages;
