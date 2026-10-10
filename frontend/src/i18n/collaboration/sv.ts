import type { CollaborationMessages } from './en';
const messages = {
  'collaboration.title': 'Samarbete i realtid',
  'collaboration.intro':
    'Arbeta tillsammans i ett diagram. Ägaren godkänner varje enhet; diagrammets innehåll krypteras mellan deltagarna.',
  'collaboration.unavailable':
    'Samarbetsreläet är inte konfigurerat. Din lokala arbetsyta fungerar som vanligt. En administratör måste konfigurera reläet innan rum kan skapas eller användas.',
  'collaboration.selectDiagram': 'Öppna ett diagram innan du skapar ett rum.',
  'collaboration.displayName': 'Ditt visningsnamn',
  'collaboration.nameHint':
    'Deltagarna väljer sina namn; de är inte verifierade företagsidentiteter. Kontrollera enhetens fingeravtryck via en betrodd kanal.',
  'collaboration.create': 'Skapa ett rum',
  'collaboration.join': 'Anslut till ett rum',
  'collaboration.invitation': 'Privat inbjudningslänk',
  'collaboration.inviteHint':
    'Länken är hemlig, gäller en gång och har en sluttid. Ägaren behöver också godkänna enheten som ansluter.',
  'collaboration.coreScope':
    'Delar diagrammets noder, kopplingar, texter, beskrivningar, anteckningar och simuleringsmodell. Andra diagram, lösenord och arbetsytans inställningar förblir lokala.',
  'collaboration.scopeTitle': 'Inkludera ytterligare information',
  'collaboration.metadata': 'Egna metadata och integrations-ID:n',
  'collaboration.owners': 'Tilldelade ansvariga och deras uppgifter',
  'collaboration.datasets': 'Rådata och CSV-analysdata',
  'collaboration.shareConsent': 'Jag har granskat diagrammet och får dela denna information.',
  'collaboration.createAction': 'Starta privat rum',
  'collaboration.joinAction': 'Begär att få ansluta',
  'collaboration.securityTitle': 'Innan du delar',
  'collaboration.securityBody':
    'Reläet ser anslutnings- och medlemsmetadata, inte diagrammets innehåll eller krypteringsnycklar. Deltagare kan spara kopior. Krypteringen skyddar inte en upplåst, komprometterad browser.',
  'collaboration.reloadWarning':
    'Krypteringsnycklarna för live-sessionen finns bara i minnet. Omladdning eller låsning avslutar din lokala session. Ägaren skapar ett nytt rum; andra deltagare behöver en ny inbjudan och ett nytt godkännande.',
  'collaboration.backupWarning':
    'Borttagning av en deltagare eller byte av lösenord kan inte återkalla skärmbilder, exporter, säkerhetskopior eller information som redan kopierats.',
  'collaboration.joinWarning':
    'Kontrollera inbjudan och ägaren via en betrodd kanal. Anslutningen skapar ett separat lokalt diagram; dina andra diagram delas inte.',
  'collaboration.copy': 'Kopiera privat inbjudan',
  'collaboration.copied': 'Inbjudan kopierad. Dela den via en privat, betrodd kanal.',
  'collaboration.copyFailed':
    'Browsern kunde inte kopiera länken. Markera och kopiera den manuellt.',
  'collaboration.newInvitation': 'Skapa engångsinbjudan',
  'collaboration.expires': 'Giltig till: {date}',
  'collaboration.participants': 'Deltagare i rummet',
  'collaboration.pending': 'Väntar på ditt godkännande',
  'collaboration.fingerprint': 'Enhetens fingeravtryck',
  'collaboration.compareFingerprint':
    'Jämför hela fingeravtrycket med personen via en betrodd kanal innan du godkänner.',
  'collaboration.approve': 'Godkänn enheten',
  'collaboration.reject': 'Avvisa förfrågan',
  'collaboration.role': 'Behörighet',
  'collaboration.role.owner': 'Ägare',
  'collaboration.role.editor': 'Redigerare',
  'collaboration.role.viewer': 'Läsare',
  'collaboration.roleHint':
    'Redigerare ändrar diagrammet. Läsare läser det. Bara ägaren godkänner enheter och ändrar behörigheter.',
  'collaboration.self': 'Du',
  'collaboration.online': 'Ansluten',
  'collaboration.offline': 'Frånkopplad',
  'collaboration.selected': 'Valda noder: {count}',
  'collaboration.agent': 'MCP-agent',
  'collaboration.remove': 'Ta bort deltagare',
  'collaboration.leave': 'Lämna rummet',
  'collaboration.closeRoom': 'Stäng rummet för alla',
  'collaboration.confirmTitle': 'Bekräfta ändring i rummet',
  'collaboration.confirmRemove':
    'Ta bort {name}? Enheten förlorar åtkomst till framtida meddelanden. Redan mottagna kopior kan inte återkallas.',
  'collaboration.confirmChangeRole':
    'Ändra {name} till {role}? Behörigheten gäller framtida åtgärder i rummet.',
  'collaboration.confirmReject':
    'Avvisa enhetens förfrågan? En ny inbjudan krävs för att försöka igen.',
  'collaboration.confirmLeave':
    'Lämna live-rummet? Ditt sparade lokala diagram finns kvar. Återkomst kräver en ny inbjudan och ett nytt godkännande.',
  'collaboration.confirmClose':
    'Stäng rummet för alla? Alla deltagare kopplas från. Sparade lokala diagram och kopior finns kvar.',
  'collaboration.confirm': 'Bekräfta ändring',
  'collaboration.cancel': 'Avbryt',
  'collaboration.busy': 'Arbetar…',
  'collaboration.reconnect': 'Återanslut live-sessionen',
  'collaboration.errorTitle': 'Samarbetet kräver uppmärksamhet',
  'collaboration.syncProgress': 'Synkar: {completed} av {total} delar',
  'collaboration.status.idle': 'Lokal arbetsyta',
  'collaboration.status.connecting': 'Ansluter',
  'collaboration.status.awaiting-approval': 'Väntar på ägarens godkännande',
  'collaboration.status.syncing': 'Synkroniserar diagrammet',
  'collaboration.status.live': 'Live',
  'collaboration.status.offline': 'Offline · livesynk pausad',
  'collaboration.status.conflict': 'Ändringar behöver granskas · synk pausad',
  'collaboration.status.error': 'Anslutningen kräver uppmärksamhet',
  'collaboration.sharing': 'Ingår i rummet',
  'collaboration.room': 'Rum: {id}',
  'collaboration.ownerFingerprint': 'Ägarenhetens fingeravtryck',
  'collaboration.selfFingerprint': 'Din enhets fingeravtryck',
  'collaboration.selfFingerprintHint':
    'Dela hela fingeravtrycket med ägaren via en separat betrodd kanal före godkännande.',
  'collaboration.recoveryCopy':
    'Dina oskickade ändringar har sparats i ett lokalt återställningsdiagram: ”{name}”. Du hittar det under {projects}. Det delade diagrammet följer nu ägarens aktuella version.',
  'collaboration.open': 'Öppna samarbete och deltagare',
  'collaboration.action': 'Samarbete',
  'collaboration.requiresEncryption':
    'Livesamarbete kräver den krypterade appens arbetsyta. Du kan fortsätta redigera dina lokala diagram här. Att öppna den krypterade appen flyttar eller delar inte dina befintliga diagram.',
  'collaboration.openEncryptedApp': 'Öppna den krypterade appen',
  'collaboration.connectedCount': '{count} anslutna',
} satisfies CollaborationMessages;
export default messages;
