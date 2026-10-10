import type { CollaborationMessages } from './en';
const messages = {
  'collaboration.title': 'Samarbejde i realtid',
  'collaboration.intro':
    'Arbejd sammen om ét diagram. Ejeren godkender hver enhed; indholdet krypteres mellem deltagerne.',
  'collaboration.unavailable':
    'Samarbejdsrelæet er ikke konfigureret. Dit lokale arbejdsområde fungerer normalt. En administrator skal konfigurere relæet, før rum kan oprettes eller bruges.',
  'collaboration.selectDiagram': 'Åbn et diagram, før du opretter et rum.',
  'collaboration.displayName': 'Dit visningsnavn',
  'collaboration.nameHint':
    'Deltagerne vælger selv navne; de er ikke verificerede virksomhedsidentiteter. Kontrollér enhedens fingeraftryk via en betroet kanal.',
  'collaboration.create': 'Opret et rum',
  'collaboration.join': 'Deltag i et rum',
  'collaboration.invitation': 'Privat invitationslink',
  'collaboration.inviteHint':
    'Linket er hemmeligt, kan bruges én gang og udløber. Ejeren skal også godkende den enhed, der tilslutter sig.',
  'collaboration.coreScope':
    'Deler diagrammets noder, forbindelser, tekster, beskrivelser, noter og simuleringsmodel. Andre diagrammer, adgangskoder og arbejdsområdets indstillinger forbliver lokale.',
  'collaboration.scopeTitle': 'Medtag yderligere oplysninger',
  'collaboration.metadata': 'Egne metadata og integrations-ID’er',
  'collaboration.owners': 'Tildelte ansvarlige og deres oplysninger',
  'collaboration.datasets': 'Rådatasæt og CSV-analysedata',
  'collaboration.shareConsent': 'Jeg har gennemgået diagrammet og må dele disse oplysninger.',
  'collaboration.createAction': 'Start privat rum',
  'collaboration.joinAction': 'Anmod om at deltage',
  'collaboration.securityTitle': 'Før du deler',
  'collaboration.securityBody':
    'Relæet ser forbindelses- og medlemsmetadata, ikke diagrammets indhold eller krypteringsnøgler. Deltagere kan gemme kopier. Krypteringen beskytter ikke en ulåst, kompromitteret browser.',
  'collaboration.reloadWarning':
    'Krypteringsnøglerne til live-sessionen findes kun i hukommelsen. Genindlæsning eller låsning afslutter din lokale session. Ejeren opretter et nyt rum; andre deltagere skal have en ny invitation og godkendelse.',
  'collaboration.backupWarning':
    'Fjernelse af en deltager eller ændring af adgangskoden kan ikke tilbagekalde skærmbilleder, eksporter, sikkerhedskopier eller oplysninger, som allerede er kopieret.',
  'collaboration.joinWarning':
    'Kontrollér invitationen og ejeren via en betroet kanal. Tilslutning opretter et separat lokalt diagram; dine andre diagrammer deles ikke.',
  'collaboration.copy': 'Kopiér privat invitation',
  'collaboration.copied': 'Invitation kopieret. Del den via en privat, betroet kanal.',
  'collaboration.copyFailed': 'Browseren kunne ikke kopiere linket. Markér og kopiér det manuelt.',
  'collaboration.newInvitation': 'Opret engangsinvitation',
  'collaboration.expires': 'Udløber: {date}',
  'collaboration.participants': 'Deltagere i rummet',
  'collaboration.pending': 'Afventer din godkendelse',
  'collaboration.fingerprint': 'Enhedens fingeraftryk',
  'collaboration.compareFingerprint':
    'Sammenlign hele fingeraftrykket med personen via en betroet kanal, før du godkender.',
  'collaboration.approve': 'Godkend enheden',
  'collaboration.reject': 'Afvis anmodning',
  'collaboration.role': 'Tilladelse',
  'collaboration.role.owner': 'Ejer',
  'collaboration.role.editor': 'Redaktør',
  'collaboration.role.viewer': 'Læser',
  'collaboration.roleHint':
    'Redaktører ændrer diagrammet. Læsere læser det. Kun ejeren godkender enheder og ændrer tilladelser.',
  'collaboration.self': 'Dig',
  'collaboration.online': 'Tilsluttet',
  'collaboration.offline': 'Frakoblet',
  'collaboration.selected': 'Valgte noder: {count}',
  'collaboration.agent': 'MCP-agent',
  'collaboration.remove': 'Fjern deltager',
  'collaboration.leave': 'Forlad rummet',
  'collaboration.closeRoom': 'Luk rummet for alle',
  'collaboration.confirmTitle': 'Bekræft ændring i rummet',
  'collaboration.confirmRemove':
    'Fjern {name}? Enheden mister adgang til fremtidige meddelelser. Allerede modtagne kopier kan ikke tilbagekaldes.',
  'collaboration.confirmChangeRole':
    'Skift {name} til {role}? Tilladelsen gælder fremtidige handlinger i rummet.',
  'collaboration.confirmReject':
    'Afvis enhedens anmodning? En ny invitation kræves for at prøve igen.',
  'collaboration.confirmLeave':
    'Forlad live-rummet? Dit gemte lokale diagram bevares. Du skal have en ny invitation og godkendelse for at vende tilbage.',
  'collaboration.confirmClose':
    'Luk rummet for alle? Alle deltagere frakobles. Gemte lokale diagrammer og kopier bevares.',
  'collaboration.confirm': 'Bekræft ændring',
  'collaboration.cancel': 'Annuller',
  'collaboration.busy': 'Arbejder…',
  'collaboration.reconnect': 'Tilslut live-sessionen igen',
  'collaboration.errorTitle': 'Samarbejdet kræver opmærksomhed',
  'collaboration.syncProgress': 'Synkroniserer: {completed} af {total} dele',
  'collaboration.status.idle': 'Lokalt arbejdsområde',
  'collaboration.status.connecting': 'Tilslutter',
  'collaboration.status.awaiting-approval': 'Afventer ejerens godkendelse',
  'collaboration.status.syncing': 'Synkroniserer diagrammet',
  'collaboration.status.live': 'Live',
  'collaboration.status.offline': 'Offline · livesynkronisering pauset',
  'collaboration.status.conflict': 'Ændringer skal gennemgås · synkronisering pauset',
  'collaboration.status.error': 'Forbindelsen kræver opmærksomhed',
  'collaboration.sharing': 'Medtaget i rummet',
  'collaboration.room': 'Rum: {id}',
  'collaboration.ownerFingerprint': 'Ejerenhedens fingeraftryk',
  'collaboration.selfFingerprint': 'Din enheds fingeraftryk',
  'collaboration.selfFingerprintHint':
    'Del hele fingeraftrykket med ejeren gennem en separat betroet kanal før godkendelse.',
  'collaboration.recoveryCopy':
    'Dine usendte ændringer er gemt i et lokalt gendannelsesdiagram: ”{name}”. Find det under {projects}. Det delte diagram følger nu ejerens aktuelle version.',
  'collaboration.open': 'Åbn samarbejde og deltagere',
  'collaboration.action': 'Samarbejde',
  'collaboration.requiresEncryption':
    'Livesamarbejde kræver den krypterede apps arbejdsområde. Du kan fortsætte med at redigere dine lokale diagrammer her. Åbning af den krypterede app flytter eller deler ikke dine eksisterende diagrammer.',
  'collaboration.openEncryptedApp': 'Åbn den krypterede app',
  'collaboration.connectedCount': '{count} tilsluttet',
} satisfies CollaborationMessages;
export default messages;
